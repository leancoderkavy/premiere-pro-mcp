import { afterEach, describe, expect, it, vi } from "vitest";
import { copyFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withInvocationContext, currentInvocation, markHostDispatch, reportProgress, assertInvocationNotCancelled, measureStage } from "../../src/workflows/invocation-context.js";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";
import { strictDeclaredObjects, argumentDiagnostics } from "../../src/workflows/strict-schema.js";
import { fromJsonSchema, type JsonSchemaType } from "@modelcontextprotocol/server";
import { cachedFileAnalysis, analysisCacheDiagnostics, clearAnalysisCache } from "../../src/workflows/analysis-cache.js";
import { recordPerformance, performanceDiagnostics, resetPerformanceDiagnostics } from "../../src/workflows/performance-diagnostics.js";
import { startLocalJob, cancelWorkflowJob, getWorkflowJob, normalizeNativeJob, resetWorkflowJobs } from "../../src/workflows/job-contract.js";
import { annotationsForTool } from "../../src/workflows/tool-metadata.js";

afterEach(() => { clearAnalysisCache(); resetPerformanceDiagnostics(); resetWorkflowJobs(); });
describe("per-invocation observer boundary", () => {
  it("isolates concurrent operation state and never leaks a signal or receipt", async () => {
    const [left,right] = await Promise.all([
      withInvocationContext({}, async () => { markHostDispatch(); await Promise.resolve(); return currentInvocation()?.dispatched; }),
      withInvocationContext({}, async () => { await Promise.resolve(); return currentInvocation()?.dispatched; }),
    ]);
    expect([left,right]).toEqual([true,false]); expect(currentInvocation()).toBeUndefined(); markHostDispatch();
  });
  it("sends only bounded monotonic progress with a supplied token", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    await reportProgress(2,3);
    await withInvocationContext({ notify }, () => reportProgress(1,2)); expect(notify).not.toHaveBeenCalled();
    await withInvocationContext({ notify, progressToken: "observer" }, async () => {
      await reportProgress(0,3); await reportProgress(0,3); await reportProgress(-1); await reportProgress(Number.NaN);
      await reportProgress(2,1); await reportProgress(1,3); // throttled
      await reportProgress(3,3,"Complete local stages".repeat(20)); await reportProgress(2,3);
    });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1][0].params).toMatchObject({ progressToken:"observer", progress:3,total:3 });
    expect(notify.mock.calls[1][0].params.message.length).toBe(160);
  });
  it("notification loss never changes the operation; cancellation is explicit", async () => {
    const controller = new AbortController(); controller.abort();
    await withInvocationContext({ notify: vi.fn().mockRejectedValue(Error("gone")), progressToken: 0, signal: controller.signal }, async () => {
      await reportProgress(1,1); expect(() => assertInvocationNotCancelled()).toThrow("REQUEST_CANCELLED_BEFORE_DISPATCH");
    });
    assertInvocationNotCancelled();
  });
  it("records measured stages even when a stage throws", async () => {
    await withInvocationContext({}, async () => { await expect(measureStage("analysis",async () => { throw Error("bad input"); })).rejects.toThrow(); expect(currentInvocation()?.stages.analysis).toBeGreaterThanOrEqual(0); await measureStage("analysis", async () => 1); });
    expect(await measureStage("analysis", async () => "outside")).toBe("outside");
  });
});
describe("shared mutation receipts", () => {
  it.each(["committed","verified","committed_unverified","unknown","not_applied"])("preserves %s without upgrading evidence", outcome => {
    const receipt = mutationReceipt(true,{outcome,renderVerified:false}); expect(receipt.outcome).toBe(outcome); expect(receipt.verification.renderVerified).toBe(false);
  });
  it("missing or failed postconditions after dispatch are unknown, never rolled back", () => {
    expect(mutationReceipt(false,{}, { dispatched:true })).toMatchObject({ dispatch:"unknown",outcome:"unknown" });
    expect(mutationReceipt(true,{}, { dispatched:true }).outcome).toBe("committed_unverified");
    expect(mutationReceipt(false,null).outcome).toBe("not_applied");
    // A dispatched read-only preflight followed by a refusal must not demand host recovery.
    expect(mutationReceipt(false,{ outcome:"failed", mutationOutcome:"not_applied" }, { dispatched:true }).outcome).toBe("not_applied");
    expect(mutationReceipt(false,{ outcome:"failed", mutationOutcome:"unknown" }, { dispatched:true }).outcome).toBe("unknown");
    expect(mutationReceipt(false,{ outcome:"failed" }, { dispatched:true }).outcome).toBe("unknown");
    expect(mutationReceipt(true,{backend:"uxp",result:{outcome:"verified",verificationScope:"exact ranges",steps:[1],targets:[2],artifact:{hash:"x"}}})).toMatchObject({outcome:"verified",partialSteps:[1],affectedTargets:[2],outputEvidence:{hash:"x"}});
    expect(mutationReceipt(true,{accepted:true}, {dispatched:true}).dispatch).toBe("accepted");
    expect(mutationReceipt(false,{stateUnknown:true}).nextSafeAction).toContain("do not replay");
    expect(mutationReceipt(true,{dispatched:false}).dispatch).toBe("not_dispatched");
  });
  it("honors explicit metadata while mixed action tools stay conservative", () => {
    expect(annotationsForTool("manage_markers_uxp").destructiveHint).toBe(true);
    expect(annotationsForTool("custom_query",{readOnlyHint:true,idempotentHint:true,title:"Reviewed query"})).toMatchObject({readOnlyHint:true,title:"Reviewed query"});
  });
});
describe("nested schemas", () => {
  it("closes declared objects, retains explicitly open maps and names nested typos", async () => {
    const schema = strictDeclaredObjects({type:"object",properties:{ edits:{type:"array",items:{type:"object",properties:{ticks:{type:"string"}}}}, labels:{type:"object",additionalProperties:true} }});
    expect(argumentDiagnostics({edits:[{tick:"1"}]},schema)[0]).toContain("unknown argument tick");
    expect(argumentDiagnostics({edits:[{tick:"1"}]},schema)[0]).toContain("/edits/0");
    expect(argumentDiagnostics({edits:[{ticks:"1"}],labels:{custom:1}},schema)).toEqual([]);
    expect(argumentDiagnostics({edits:[],bad:1},schema)[0]).toContain("unknown argument bad");
    const result = await fromJsonSchema(schema as JsonSchemaType)["~standard"].validate({edits:[{tick:"1"}]}); expect(result).toHaveProperty("issues");
    expect(argumentDiagnostics(Number.NaN,{})).toEqual(["INVALID_NUMBER: / must be finite"]);
  });
  it("does not independently close shared allOf/oneOf branches", async () => {
    const schema = strictDeclaredObjects({type:"object",allOf:[{properties:{a:{type:"string"}}},{properties:{b:{type:"string"}}}]});
    expect((schema.allOf as any)[0].additionalProperties).toBeUndefined();
    const result = await fromJsonSchema(schema as JsonSchemaType)["~standard"].validate({a:"a",b:"b"}); expect(result).not.toHaveProperty("issues");
  });
});
describe("content addressed analysis", () => {
  it("reuses immutable results only for same content, options, revision and version", async () => {
    const dir = mkdtempSync(join(tmpdir(),"mcp-cache-")); const file = join(dir,"source"); writeFileSync(file,"original"); const work = vi.fn(async () => ({ success:true,data:{value:[1]} }));
    try {
      const first = await cachedFileAnalysis(file,{sample:1},"r1","v1",work); (first.value.data.value as number[]).push(2);
      const second = await cachedFileAnalysis(file,{sample:1},"r1","v1",work); expect(second.hit).toBe(true); expect(second.value.data.value).toEqual([1]);
      for (const [options,revision,version] of [[{sample:2},"r1","v1"],[{sample:1},"r2","v1"],[{sample:1},"r1","v2"]] as const) expect((await cachedFileAnalysis(file,options,revision,version,work)).hit).toBe(false);
      writeFileSync(file,"replacement"); expect((await cachedFileAnalysis(file,{sample:1},"r1","v1",work)).hit).toBe(false);
      expect(analysisCacheDiagnostics().entries).toBe(5);
      expect(JSON.stringify(analysisCacheDiagnostics())).not.toContain(file);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
  it("never caches failures or changing files", async () => {
    const dir = mkdtempSync(join(tmpdir(),"mcp-cache-")); const file = join(dir,"source"); writeFileSync(file,"before");
    try {
      const work = vi.fn(async () => ({success:false,error:"decode failed"})); await cachedFileAnalysis(file,{},"r","v",work); await cachedFileAnalysis(file,{},"r","v",work); expect(work).toHaveBeenCalledTimes(2);
      await expect(cachedFileAnalysis(file,{},"r","v",async () => {writeFileSync(file,"changed longer");return {success:true};})).rejects.toThrow("ANALYSIS_SOURCE_CHANGED");
      await expect(cachedFileAnalysis(dir,{},"r","v",async () => 1)).rejects.toThrow("ANALYSIS_NOT_FILE");
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
  it("retains each same-key concurrent result once and safely evicts under byte pressure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-cache-concurrent-"));
    const file = join(dir, "source"); writeFileSync(file, "same media");
    const value = { success: true, data: "x".repeat(128 * 1024) };
    let entered = 0;
    let allEntered!: () => void;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { allEntered = resolve; });
    const completion = new Promise<void>(resolve => { release = resolve; });
    try {
      const pending = Array.from({ length: 64 }, () => cachedFileAnalysis(file, {}, "r", "v", async () => {
        if (++entered === 64) allEntered();
        await completion;
        return value;
      }));
      await barrier;
      expect(analysisCacheDiagnostics().entries).toBe(0);
      release();
      expect((await Promise.all(pending)).every(result => !result.hit)).toBe(true);
      expect(analysisCacheDiagnostics()).toMatchObject({ entries: 1, retainedBytes: Buffer.byteLength(JSON.stringify(value)) });
      const cached = await cachedFileAnalysis(file, {}, "r", "v", async () => { throw Error("must hit"); });
      expect(cached.hit).toBe(true);
      const next = { success: true, data: "y".repeat(1024 * 1024) };
      await expect(cachedFileAnalysis(file, { next: true }, "r", "v", async () => next)).resolves.toMatchObject({ hit: false });
      expect(analysisCacheDiagnostics().retainedBytes).toBe(Buffer.byteLength(JSON.stringify(value)) + Buffer.byteLength(JSON.stringify(next)));
      const large = { success: true, data: "z".repeat(3 * 1024 * 1024) };
      for (let sample = 0; sample < 3; sample++) await cachedFileAnalysis(file, { sample }, "r", "v", async () => large);
      expect(analysisCacheDiagnostics()).toMatchObject({ entries: 2, retainedBytes: 2 * Buffer.byteLength(JSON.stringify(large)) });
    } finally { release(); rmSync(dir, { recursive: true, force: true }); }
  });
  it("isolates path-bearing results for distinct sources with identical media bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-cache-source-"));
    const first = join(dir, "one.mov"), second = join(dir, "two.mov");
    writeFileSync(first, "identical bytes"); copyFileSync(first, second);
    const analyze = vi.fn(async (file: string) => ({ success: true, data: { mediaPath: file, format: { filename: file } } }));
    try {
      await cachedFileAnalysis(first, {}, "r", "v", () => analyze(first));
      const otherSource = await cachedFileAnalysis(second, {}, "r", "v", () => analyze(second));
      expect(otherSource).toMatchObject({ hit: false, value: { data: { mediaPath: second, format: { filename: second } } } });
      const sameSource = await cachedFileAnalysis(second, {}, "r", "v", () => analyze(second));
      expect(sameSource).toMatchObject({ hit: true, value: { data: { mediaPath: second, format: { filename: second } } } });
      expect(analyze).toHaveBeenCalledTimes(2);
      expect(analysisCacheDiagnostics().entries).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
describe("jobs and private diagnostics", () => {
  it("local queue cancellation prevents dispatch; disappearance stays unknown", async () => {
    const work = vi.fn(async () => ({success:true})); const job = startLocalJob({file:"private"},work);
    expect(cancelWorkflowJob(job.id)).toMatchObject({state:"cancelled",terminal:true,nativeCancelled:false});
    await new Promise(resolve => setImmediate(resolve)); expect(work).not.toHaveBeenCalled();
    expect(() => getWorkflowJob("absent")).toThrow("JOB_UNKNOWN"); expect(() => cancelWorkflowJob("absent")).toThrow("JOB_UNKNOWN");
  });
  it("completes and rejects workers with precise local cancellation", async () => {
    const jobs = [startLocalJob({},async () => ({success:true,data:{done:1}})),startLocalJob({},async () => ({success:false,error:"failure"})),startLocalJob({},async () => {throw Error("throw");})];
    await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
    expect(jobs.map(job => getWorkflowJob(job.id).state)).toEqual(["completed","failed","failed"]);
    expect(cancelWorkflowJob(jobs[0].id).terminal).toBe(true);
    let finish!: () => void;
    const running = startLocalJob({},async () => {await new Promise<void>(resolve => {finish=resolve;}); return {success:true};}); await new Promise(resolve => setImmediate(resolve)); cancelWorkflowJob(running.id); finish(); await Promise.resolve(); await Promise.resolve(); expect(getWorkflowJob(running.id).state).toBe("cancelled");
  });
  it("native terminal events retain artifact and correlation boundaries", () => {
    expect(normalizeNativeJob({jobs:[{jobId:"one",state:"completed",terminal:true,progress:1}]},"one")).toMatchObject({state:"unknown",terminal:false,requiresReconciliation:true,progress:100,outputVerified:false,cancellation:"unsupported_native",result:{observedState:"completed",observedTerminal:true,correlationVerified:false}});
    expect(normalizeNativeJob({job:{jobId:"one",state:"rendering",progress:.5}},"one")).toMatchObject({state:"running",terminal:false,progress:50});
    expect(normalizeNativeJob({job:{jobId:"one",state:"missing",progress:NaN}},"one").state).toBe("unknown");
    expect(() => normalizeNativeJob({},"one")).toThrow("JOB_IDENTITY_UNKNOWN"); expect(() => normalizeNativeJob({job:{jobId:"wrong"}},"one")).toThrow("JOB_IDENTITY_UNKNOWN");
  });
  it("retains only bounded numeric performance measurements", () => {
    recordPerformance({durationMs:NaN,payloadBytes:0,stages:{},cacheHit:null}); expect(performanceDiagnostics().durationMs.count).toBe(0);
    for (let i=0;i<300;i++) recordPerformance({durationMs:i,payloadBytes:i===299 ? -1:i,stages:{analysis:i,host_wait:NaN},cacheHit:i%2===0});
    const result = performanceDiagnostics(); expect(result.durationMs.count).toBe(256); expect(result.durationMs.p95).toBeGreaterThan(result.durationMs.median!); expect(result.stagesMs.host_wait.count).toBe(0); expect(result.cache.measured).toBe(256);
    expect(JSON.stringify(result)).not.toContain("private");
  });
});

it("validates large declared evidence while bounding diagnostic work and inherited-key mistakes", () => {
 const schema = {type:"object",additionalProperties:false,properties:{words:{type:"array",items:{type:"object",additionalProperties:false,properties:{start:{type:"number"},end:{type:"number"},text:{type:"string"}}}}}};
 expect(argumentDiagnostics({words:Array.from({length:10000},(_,i)=>({start:i,end:i+1,text:"word"}))},schema)).toEqual([]);
 expect(argumentDiagnostics({constructor:1,toString:2},schema)[0]).toContain("UNKNOWN_ARGUMENT");
 expect(argumentDiagnostics({words:Array.from({length:310000},()=>1)},schema)).toContain("ARGUMENT_LIMIT: input exceeds bounded validation size");
 expect(argumentDiagnostics({["z".repeat(10000)]:1},schema)[0].length).toBeLessThan(4096);
});
