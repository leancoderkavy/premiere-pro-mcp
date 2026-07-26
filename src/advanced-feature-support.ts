export type AdvancedFeatureBackend = "cep" | "uxp";
export type AdvancedFeatureStatus =
  | "uxp-read-only"
  | "external-api-required"
  | "user-assisted"
  | "unsupported-public-api";

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
      callableThroughCurrentMcpTransport: false,
      note: "The production MCP transport is CEP. UXP-only entries require the separate UXP bridge and live capability negotiation.",
    },
    features: {
      productions: {
        status: "uxp-read-only" as AdvancedFeatureStatus,
        availableInRequestedContext: backend === "uxp" ? productionsVersionEligible : false,
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
        availableInRequestedContext: false,
        entitlement: "Creative Cloud Team Projects entitlement",
        supportedOperations: [],
        unsupportedOperations: ["create", "share", "sync", "publish changes", "resolve conflicts"],
        userAssistedWorkflow: "Use Premiere's Team Projects panel for collaboration and conflict resolution.",
        detection: "No safe documented project-state discriminator is exposed to this integration.",
      },
      frameIo: {
        status: "external-api-required" as AdvancedFeatureStatus,
        availableInRequestedContext: false,
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
        availableInRequestedContext: false,
        entitlement: "Premiere feature availability varies by build and locale",
        supportedOperations: [],
        unsupportedOperations: ["run semantic media analysis", "query Premiere's Media Intelligence index"],
        userAssistedWorkflow: "Run Media Intelligence search in Premiere, then select or organize the resulting clips for ordinary MCP inspection.",
        detection: "Search-index state and semantic matches are not exposed by a documented public API.",
      },
      generativeExtend: {
        status: "user-assisted" as AdvancedFeatureStatus,
        availableInRequestedContext: false,
        entitlementSatisfied: context.generativeAiEntitled ?? null,
        prerequisites: ["eligible Premiere build", "Adobe generative AI entitlement", "network access"],
        networkSatisfied: context.networkAvailable ?? null,
        supportedOperations: ["inspect a generated clip as an ordinary project/timeline item after Premiere creates it"],
        unsupportedOperations: ["invoke Generative Extend", "inspect generation job or provenance"],
        userAssistedWorkflow: "Run Generative Extend in Premiere, then re-query project and timeline items.",
        detection: "No documented flag safely distinguishes a generated extension from an ordinary clip.",
      },
      objectMask: {
        status: "user-assisted" as AdvancedFeatureStatus,
        availableInRequestedContext: false,
        supportedOperations: ["inspect ordinary effect components after a mask is created"],
        unsupportedOperations: ["invoke object selection", "run tracking", "identify an Object Mask artifact reliably"],
        userAssistedWorkflow: "Create and track the mask in Premiere, then use generic effect/property inspection where exposed.",
        detection: "No documented stable Object Mask identifier is exposed.",
      },
      captionTranslation: {
        status: "user-assisted" as AdvancedFeatureStatus,
        availableInRequestedContext: false,
        prerequisites: ["supported source/target language", "network access and service availability"],
        networkSatisfied: context.networkAvailable ?? null,
        supportedOperations: ["inspect resulting caption tracks through documented caption-track APIs"],
        unsupportedOperations: ["invoke caption translation", "inspect translation job state"],
        userAssistedWorkflow: "Translate captions in Premiere, then inspect the resulting caption track.",
        detection: "No documented metadata identifies a caption track as machine-translated.",
      },
      speechToText: {
        status: "user-assisted" as AdvancedFeatureStatus,
        availableInRequestedContext: false,
        minPremiereVersionForTranscriptIO: "25.6.0",
        supportedOperations: ["UXP transcript JSON import", "UXP transcript JSON export"],
        unsupportedOperations: ["start Speech-to-Text transcription", "monitor transcription progress"],
        userAssistedWorkflow: "Transcribe the clip in Premiere; UXP clients can then import or export the transcript JSON.",
        detection: "Transcript.hasTranscript is documented in Premiere 26.3+; export probing is available in 25.6+.",
        docs: "https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/transcript",
      },
      enhanceSpeech: {
        status: "unsupported-public-api" as AdvancedFeatureStatus,
        availableInRequestedContext: false,
        supportedOperations: ["inspect generic audio effects if Premiere represents the result there"],
        unsupportedOperations: ["invoke Enhance Speech", "set mix amount", "inspect analysis progress"],
        userAssistedWorkflow: "Apply Enhance Speech in Premiere, then verify playback and generic audio state manually.",
        detection: "No documented stable Enhance Speech artifact identifier or invocation API is exposed.",
      },
      remix: {
        status: "unsupported-public-api" as AdvancedFeatureStatus,
        availableInRequestedContext: false,
        supportedOperations: ["inspect the resulting timeline clip duration after the user applies Remix"],
        unsupportedOperations: ["invoke Remix", "set target duration through a dedicated API", "inspect analysis state"],
        userAssistedWorkflow: "Apply Remix in Premiere, then inspect the resulting clip duration with timeline tools.",
        detection: "A changed clip duration alone is not proof that Remix was applied.",
      },
    },
  };
}
