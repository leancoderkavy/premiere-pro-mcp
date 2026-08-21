export type AdvancedFeatureBackend = "cep" | "uxp";
export type AdvancedFeatureStatus =
  | "uxp-read-only"
  | "external-api-required"
  | "user-assisted"
  | "unsupported-public-api"
  | "local-planning"
  | "planned-local";

export type AdvancedFeatureAccess =
  | "direct"
  | "observable-only"
  | "artifact-import"
  | "external-provider"
  | "user-assisted"
  | "unavailable"
  | "planned";

export interface AdvancedFeatureContext {
  backend?: AdvancedFeatureBackend;
  premiereVersion?: string;
  frameIoEntitled?: boolean;
  generativeAiEntitled?: boolean;
  networkAvailable?: boolean;
}

function versionAtLeast(version: string | undefined, minimum: string): boolean | null {
  if (!version) return null;
  if (!/^\d+(?:\.\d+){0,3}$/.test(version)) throw new Error("premiere_version must contain only numeric version components");
  const current = version.split(".").map(Number);
  const required = minimum.split(".").map(Number);
  for (let index = 0; index < Math.max(current.length, required.length); index += 1) {
    const left = current[index] ?? 0;
    const right = required[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

export function buildAdvancedFeatureSupport(context: AdvancedFeatureContext = {}) {
  const backend = context.backend ?? "cep";
  const productionsVersionEligible = versionAtLeast(context.premiereVersion, "25.6.0");

  return {
    schemaVersion: 1,
    context: {
      backend,
      premiereVersion: context.premiereVersion ?? null,
      frameIoEntitled: context.frameIoEntitled ?? null,
      generativeAiEntitled: context.generativeAiEntitled ?? null,
      networkAvailable: context.networkAvailable ?? null,
    },
    policy: {
      publicApisOnly: true,
      uiAutomation: false,
      privateApis: false,
      reportTool: {
        transport: "local",
        callableThroughCurrentMcpTransport: true,
        contactsPremiereHost: false,
        note: "This report is computed locally from documented support metadata and caller-supplied context.",
      },
      featureOperations: {
        currentMcpTransport: "cep",
        uxpOperationsRoutedByCurrentMcpTransport: false,
        liveHostCapabilityNegotiationRequired: true,
        note: "UXP-only feature operations require the separate UXP bridge and live capability negotiation.",
      },
    },
    features: {
      productions: {
        status: "uxp-read-only" as AdvancedFeatureStatus,
        access: "direct" as AdvancedFeatureAccess,
        staticEligibility: {
          backendEligible: backend === "uxp",
          versionEligible: productionsVersionEligible,
          eligible:
            backend === "uxp" && productionsVersionEligible === true
              ? true
              : backend !== "uxp" || productionsVersionEligible === false
                ? false
                : null,
        },
        liveHostVerificationRequired: true,
        callableThroughCurrentMcpTransport: false,
        minPremiereVersion: "25.6.0",
        entitlement: "local-project-feature",
        documentedSurface: [
          "PRProduction.getActiveProduction",
          "PRProduction.getScratchDiskSettings",
        ],
        supportedOperations: ["inspect active Production", "inspect scratch-disk settings"],
        unsupportedOperations: ["create Production", "add project", "lock project", "resolve conflicts"],
        userAssistedWorkflow: "Open the Production in Premiere, then use a UXP-capable client to inspect its active state.",
        docs: "https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/prproduction/",
      },
      teamProjects: {
        status: "unsupported-public-api" as AdvancedFeatureStatus,
        access: "unavailable" as AdvancedFeatureAccess,
        callableThroughCurrentMcpTransport: false,
        entitlement: "Creative Cloud Team Projects entitlement",
        supportedOperations: [],
        unsupportedOperations: ["create", "share", "sync", "publish changes", "resolve conflicts"],
        userAssistedWorkflow: "Use Premiere's Team Projects panel for collaboration and conflict resolution.",
        detection: "No safe documented project-state discriminator is exposed to this integration.",
      },
      frameIo: {
        status: "external-api-required" as AdvancedFeatureStatus,
        access: "external-provider" as AdvancedFeatureAccess,
        callableThroughCurrentMcpTransport: false,
        entitlementSatisfied: context.frameIoEntitled ?? null,
        prerequisites: ["Frame.io account and project access", "Frame.io API integration", "network access"],
        networkSatisfied: context.networkAvailable ?? null,
        supportedOperations: [],
        unsupportedOperations: ["upload", "create review link", "read comments", "convert comments to markers"],
        userAssistedWorkflow: "Use Premiere's Frame.io panel, or connect a separately authenticated Frame.io API client.",
        detection: "Premiere DOM does not safely identify Frame.io review state.",
      },
      mediaIntelligence: {
        status: "user-assisted" as AdvancedFeatureStatus,
        access: "user-assisted" as AdvancedFeatureAccess,
        callableThroughCurrentMcpTransport: false,
        entitlement: "Premiere feature availability varies by build and locale",
        supportedOperations: [],
        unsupportedOperations: ["run semantic media analysis", "query Premiere's Media Intelligence index"],
        userAssistedWorkflow: "Run Media Intelligence search in Premiere, then select or organize the resulting clips for ordinary MCP inspection.",
        detection: "Search-index state and semantic matches are not exposed by a documented public API.",
      },
      generativeExtend: {
        status: "user-assisted" as AdvancedFeatureStatus,
        access: "observable-only" as AdvancedFeatureAccess,
        callableThroughCurrentMcpTransport: false,
        entitlementSatisfied: context.generativeAiEntitled ?? null,
        prerequisites: ["eligible Premiere build", "Adobe generative AI entitlement", "network access"],
        networkSatisfied: context.networkAvailable ?? null,
        supportedOperations: ["inspect a generated clip as an ordinary project/timeline item after Premiere creates it", "wait for a bounded UXP Generative Extend completion receipt after the editor starts the operation"],
        unsupportedOperations: ["invoke Generative Extend", "inspect generation job or provenance"],
        userAssistedWorkflow: "Run Generative Extend in Premiere, then re-query project and timeline items.",
        detection: "No documented flag safely identifies the generated clip or proves rendered output/provenance; the UXP bridge can only observe an operation-completion receipt.",
      },
      objectMask: {
        status: "partial" as AdvancedFeatureStatus,
        access: "direct" as AdvancedFeatureAccess,
        callableThroughCurrentMcpTransport: true,
        prerequisites: ["Premiere Pro 26.3+", "connected UXP bridge"],
        supportedOperations: ["detect whether a project or sequence contains an Object Mask"],
        unsupportedOperations: ["invoke object selection", "create an Object Mask", "run tracking", "edit Object Mask parameters"],
        userAssistedWorkflow: "Create and track the mask in Premiere; the MCP can then detect its presence through the documented UXP API.",
        detection: "Premiere Pro 26.3+ exposes ObjectMaskUtils.hasObjectMask through the documented UXP API.",
      },
      captionTranslation: {
        status: "user-assisted" as AdvancedFeatureStatus,
        access: "artifact-import" as AdvancedFeatureAccess,
        callableThroughCurrentMcpTransport: false,
        prerequisites: ["supported source/target language", "network access and service availability"],
        networkSatisfied: context.networkAvailable ?? null,
        supportedOperations: ["inspect resulting caption tracks through documented caption-track APIs"],
        unsupportedOperations: ["invoke caption translation", "inspect translation job state"],
        userAssistedWorkflow: "Translate captions in Premiere, then inspect the resulting caption track.",
        detection: "No documented metadata identifies a caption track as machine-translated.",
      },
      speechToText: {
        status: "user-assisted" as AdvancedFeatureStatus,
        access: "artifact-import" as AdvancedFeatureAccess,
        callableThroughCurrentMcpTransport: false,
        minPremiereVersionForTranscriptIO: "25.6.0",
        supportedOperations: ["UXP transcript JSON import", "UXP transcript JSON export"],
        unsupportedOperations: ["start Speech-to-Text transcription", "monitor transcription progress"],
        userAssistedWorkflow: "Transcribe the clip in Premiere; UXP clients can then import or export the transcript JSON.",
        detection: "Transcript.hasTranscript is documented in Premiere 26.3+; export probing is available in 25.6+.",
        docs: "https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/transcript",
      },
      enhanceSpeech: {
        status: "unsupported-public-api" as AdvancedFeatureStatus,
        access: "user-assisted" as AdvancedFeatureAccess,
        callableThroughCurrentMcpTransport: false,
        supportedOperations: ["inspect generic audio effects if Premiere represents the result there"],
        unsupportedOperations: ["invoke Enhance Speech", "set mix amount", "inspect analysis progress"],
        userAssistedWorkflow: "Apply Enhance Speech in Premiere, then verify playback and generic audio state manually.",
        detection: "No documented stable Enhance Speech artifact identifier or invocation API is exposed.",
      },
      remix: {
        status: "unsupported-public-api" as AdvancedFeatureStatus,
        access: "user-assisted" as AdvancedFeatureAccess,
        callableThroughCurrentMcpTransport: false,
        supportedOperations: ["inspect the resulting timeline clip duration after the user applies Remix"],
        unsupportedOperations: ["invoke Remix", "set target duration through a dedicated API", "inspect analysis state"],
        userAssistedWorkflow: "Apply Remix in Premiere, then inspect the resulting clip duration with timeline tools.",
        detection: "A changed clip duration alone is not proof that Remix was applied.",
      },
      editorialPlans: {
        status: "local-planning" as AdvancedFeatureStatus,
        access: "direct" as AdvancedFeatureAccess,
        callableThroughCurrentMcpTransport: true,
        supportedOperations: ["create an evidence-backed editorial plan", "preview a plan against saved local context revisions"],
        unsupportedOperations: ["apply a compound autonomous edit", "call an LLM", "upload media", "bypass the authority of the routed Premiere tool"],
        userAssistedWorkflow: "Capture local project context, create and preview a plan, then review each routed Premiere operation before invoking it.",
        detection: "Plans are local, revision-aware decision artifacts. A matching stored revision does not prove that the live Premiere host has not changed since capture.",
      },
      localSemanticIndex: {
        status: "planned-local" as AdvancedFeatureStatus,
        access: "planned" as AdvancedFeatureAccess,
        callableThroughCurrentMcpTransport: false,
        supportedOperations: [],
        unsupportedOperations: ["sample media", "run local visual/audio inference", "query a semantic index"],
        userAssistedWorkflow: "Use explicit project-context enrichments today. A future local worker must be workspace-scoped, opt-in, and separately benchmarked before it can add semantic evidence.",
        detection: "Premiere's Media Intelligence index is not exposed by a documented public API; this planned feature must use a separately built local index and must not be branded as Adobe Media Intelligence.",
      },
      premiereAiAssistant: {
        status: "user-assisted" as AdvancedFeatureStatus,
        access: "user-assisted" as AdvancedFeatureAccess,
        callableThroughCurrentMcpTransport: false,
        prerequisites: ["Premiere (beta) access", "Adobe AI Assistant availability", "editor direction"],
        supportedOperations: ["inspect and edit the resulting ordinary project items/sequences through supported MCP tools"],
        unsupportedOperations: ["invoke Premiere AI Assistant", "read its chat history", "reuse its private reasoning/tool calls"],
        userAssistedWorkflow: "Run Premiere AI Assistant in its beta panel, then capture and inspect the resulting project state through MCP before any follow-up mutation.",
        detection: "No documented UXP or CEP API exposes Premiere AI Assistant conversations, permissions, planning state, or invocation.",
      },
      generativeMedia: {
        status: "user-assisted" as AdvancedFeatureStatus,
        access: "user-assisted" as AdvancedFeatureAccess,
        callableThroughCurrentMcpTransport: false,
        prerequisites: ["Premiere (beta) access", "eligible Adobe plan/region", "network access", "generative credits"],
        networkSatisfied: context.networkAvailable ?? null,
        supportedOperations: ["inspect generated media as ordinary project/timeline items after the editor creates it"],
        unsupportedOperations: ["invoke video or sound-effect generation", "choose Adobe or partner models", "inspect generation history or credit use"],
        userAssistedWorkflow: "Generate media in Premiere (beta), review it in the generation history, then manually quarantine and inspect the resulting project items before using them in a delivery sequence.",
        detection: "No documented public API exposes the Generative Media Tool task bar, partner-model selection, prompts, reference frames, or generation history.",
      },
    },
  };
}
