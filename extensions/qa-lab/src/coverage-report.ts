// Qa Lab plugin module implements coverage report behavior.
import { normalizeStringEntriesLower } from "openclaw/plugin-sdk/string-coerce-runtime";
import {
  buildLiveTransportCoverageLaneSummaries,
  type LiveTransportCoverageLaneSummary,
} from "./live-transports/shared/live-transport-scenarios.js";
import { QA_SCENARIO_PACKS, type QaSeedScenarioWithSource } from "./scenario-catalog.js";
import {
  readQaScorecardTaxonomyReport,
  type QaScorecardTaxonomyReport,
} from "./scorecard-taxonomy.js";

type QaCoverageScenarioSummary = {
  id: string;
  title: string;
  sourcePath: string;
  theme: string;
  surfaces: string[];
  risk: string;
};

type QaScenarioSearchMatch = QaCoverageScenarioSummary & {
  featureIds: string[];
  docsRefs: string[];
  codeRefs: string[];
  executionKind: QaSeedScenarioWithSource["execution"]["kind"];
  executionPath?: string;
  runtimeParityTier?: string;
  requiredProviderMode?: string;
  requiredProvider?: string;
  requiredModel?: string;
};

type QaCoverageIntent = "primary" | "secondary";

type QaCoverageScenarioReference = QaCoverageScenarioSummary & {
  intent: QaCoverageIntent;
};

type QaCoverageFeatureSummary = {
  id: string;
  scenarios: QaCoverageScenarioReference[];
};

type QaCoverageScenarioPackSummary = {
  id: string;
  title: string;
  scenarioIds: string[];
  featureIds: string[];
  missingScenarioIds: string[];
};

type QaCoverageInventory = {
  scenarioCount: number;
  featureIdCount: number;
  primaryFeatureIdCount: number;
  secondaryFeatureIdCount: number;
  features: QaCoverageFeatureSummary[];
  overlappingCoverage: QaCoverageFeatureSummary[];
  missingCoverage: QaCoverageScenarioSummary[];
  byTheme: Record<string, QaCoverageFeatureSummary[]>;
  bySurface: Record<string, QaCoverageFeatureSummary[]>;
  scenarioPacks: QaCoverageScenarioPackSummary[];
  liveTransportLanes: LiveTransportCoverageLaneSummary[];
  scorecardTaxonomy: QaScorecardTaxonomyReport;
};

function scenarioTheme(sourcePath: string) {
  const parts = sourcePath.split("/");
  return parts[2] ?? "unknown";
}

function scenarioSurfaces(scenario: QaSeedScenarioWithSource) {
  return scenario.surfaces && scenario.surfaces.length > 0 ? scenario.surfaces : [scenario.surface];
}

function scenarioRisk(scenario: QaSeedScenarioWithSource) {
  return scenario.risk ?? scenario.riskLevel ?? "unassigned";
}

function summarizeScenario(scenario: QaSeedScenarioWithSource): QaCoverageScenarioSummary {
  return {
    id: scenario.id,
    title: scenario.title,
    sourcePath: scenario.sourcePath,
    theme: scenarioTheme(scenario.sourcePath),
    surfaces: scenarioSurfaces(scenario),
    risk: scenarioRisk(scenario),
  };
}

function normalizeSearchText(value: string) {
  return value.toLowerCase();
}

function tokenizeScenarioSearchQuery(query: string) {
  return normalizeStringEntriesLower(query.split(/\s+/u));
}

function scenarioSearchText(scenario: QaSeedScenarioWithSource) {
  const config = scenario.execution.config ?? {};
  return normalizeSearchText(
    [
      scenario.id,
      scenario.title,
      scenario.sourcePath,
      scenario.surface,
      ...(scenario.surfaces ?? []),
      scenario.category ?? "",
      scenario.runtimeParityTier ?? "",
      scenario.risk ?? "",
      scenario.riskLevel ?? "",
      scenario.objective,
      ...scenario.successCriteria,
      ...(scenario.capabilities ?? []),
      ...(scenario.plugins ?? []),
      ...(scenario.docsRefs ?? []),
      ...(scenario.codeRefs ?? []),
      ...(scenario.coverage?.primary ?? []),
      ...(scenario.coverage?.secondary ?? []),
      ...Object.entries(config).flatMap(([key, value]) => [
        key,
        typeof value === "string" ? value : "",
      ]),
    ].join("\n"),
  );
}

function stringifyConfigValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function summarizeScenarioSearchMatch(scenario: QaSeedScenarioWithSource): QaScenarioSearchMatch {
  const config = scenario.execution.config ?? {};
  return {
    ...summarizeScenario(scenario),
    featureIds: [
      ...(scenario.coverage?.primary ?? []),
      ...(scenario.coverage?.secondary ?? []),
    ].toSorted((left, right) => left.localeCompare(right)),
    docsRefs: [...(scenario.docsRefs ?? [])],
    codeRefs: [...(scenario.codeRefs ?? [])],
    executionKind: scenario.execution.kind,
    ...(scenario.execution.kind !== "flow" ? { executionPath: scenario.execution.path } : {}),
    runtimeParityTier: scenario.runtimeParityTier,
    requiredProviderMode: stringifyConfigValue(config.requiredProviderMode),
    requiredProvider: stringifyConfigValue(config.requiredProvider),
    requiredModel: stringifyConfigValue(config.requiredModel),
  };
}

export function findQaScenarioMatches(
  scenarios: readonly QaSeedScenarioWithSource[],
  query: string,
) {
  const tokens = tokenizeScenarioSearchQuery(query);
  if (tokens.length === 0) {
    return [];
  }
  return scenarios
    .filter((scenario) => {
      const haystack = scenarioSearchText(scenario);
      return tokens.every((token) => haystack.includes(token));
    })
    .map(summarizeScenarioSearchMatch)
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

function sortFeatures(features: readonly QaCoverageFeatureSummary[]) {
  return features.toSorted((left, right) => left.id.localeCompare(right.id));
}

function buildScenarioPackSummaries(
  scenarios: readonly QaSeedScenarioWithSource[],
): QaCoverageScenarioPackSummary[] {
  const scenariosById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  return QA_SCENARIO_PACKS.map((pack) => {
    const featureIds = new Set<string>();
    const missingScenarioIds: string[] = [];
    for (const scenarioId of pack.scenarioIds) {
      const scenario = scenariosById.get(scenarioId);
      if (!scenario) {
        missingScenarioIds.push(scenarioId);
        continue;
      }
      for (const featureId of [
        ...(scenario.coverage?.primary ?? []),
        ...(scenario.coverage?.secondary ?? []),
      ]) {
        featureIds.add(featureId);
      }
    }
    return {
      id: pack.id,
      title: pack.title,
      scenarioIds: [...pack.scenarioIds],
      featureIds: [...featureIds].toSorted(),
      missingScenarioIds,
    };
  }).toSorted((left, right) => left.id.localeCompare(right.id));
}

export function buildQaCoverageInventory(
  scenarios: readonly QaSeedScenarioWithSource[],
): QaCoverageInventory {
  const byFeatureId = new Map<string, QaCoverageFeatureSummary>();
  const primaryFeatureIds = new Set<string>();
  const secondaryFeatureIds = new Set<string>();
  const missingCoverage: QaCoverageScenarioSummary[] = [];

  const addFeatureCoverage = (
    scenario: QaSeedScenarioWithSource,
    featureIds: readonly string[] | undefined,
    intent: QaCoverageIntent,
  ) => {
    const summary = summarizeScenario(scenario);
    for (const featureId of featureIds ?? []) {
      const feature = byFeatureId.get(featureId) ?? {
        id: featureId,
        scenarios: [],
      };
      feature.scenarios.push({ ...summary, intent });
      byFeatureId.set(featureId, feature);
      if (intent === "primary") {
        primaryFeatureIds.add(featureId);
      } else {
        secondaryFeatureIds.add(featureId);
      }
    }
  };

  for (const scenario of scenarios) {
    if (!scenario.coverage) {
      missingCoverage.push(summarizeScenario(scenario));
      continue;
    }
    addFeatureCoverage(scenario, scenario.coverage.primary, "primary");
    addFeatureCoverage(scenario, scenario.coverage.secondary, "secondary");
  }

  const features = sortFeatures([...byFeatureId.values()]);
  const overlappingCoverage = features.filter((feature) => feature.scenarios.length > 1);
  const byTheme: Record<string, QaCoverageFeatureSummary[]> = {};
  const bySurface: Record<string, QaCoverageFeatureSummary[]> = {};

  for (const feature of features) {
    const themes = new Set(feature.scenarios.map((scenario) => scenario.theme));
    for (const theme of themes) {
      byTheme[theme] ??= [];
      byTheme[theme].push({
        ...feature,
        scenarios: feature.scenarios.filter((scenario) => scenario.theme === theme),
      });
    }
    const surfaces = new Set(feature.scenarios.flatMap((scenario) => scenario.surfaces));
    for (const surface of surfaces) {
      bySurface[surface] ??= [];
      bySurface[surface].push({
        ...feature,
        scenarios: feature.scenarios.filter((scenario) => scenario.surfaces.includes(surface)),
      });
    }
  }

  return {
    scenarioCount: scenarios.length,
    featureIdCount: features.length,
    primaryFeatureIdCount: primaryFeatureIds.size,
    secondaryFeatureIdCount: secondaryFeatureIds.size,
    features,
    overlappingCoverage,
    missingCoverage,
    byTheme,
    bySurface,
    scenarioPacks: buildScenarioPackSummaries(scenarios),
    liveTransportLanes: buildLiveTransportCoverageLaneSummaries(),
    scorecardTaxonomy: readQaScorecardTaxonomyReport(scenarios),
  };
}

function pushFeatureLines(lines: string[], features: readonly QaCoverageFeatureSummary[]) {
  for (const feature of sortFeatures(features)) {
    const scenarios = feature.scenarios
      .map((scenario) => `${scenario.intent}: ${scenario.id} (${scenario.sourcePath})`)
      .join(", ");
    lines.push(`- ${feature.id}: ${scenarios}`);
  }
}

function pushLiveTransportLines(
  lines: string[],
  lanes: readonly LiveTransportCoverageLaneSummary[],
) {
  for (const lane of lanes) {
    const members = lane.members
      .map((member) =>
        member.scenarioId
          ? `${member.standardId}: ${member.scenarioId}`
          : `${member.standardId}: always-on`,
      )
      .join(", ");
    const missing =
      lane.baselineMissingStandardScenarioIds.length > 0
        ? lane.baselineMissingStandardScenarioIds.join(", ")
        : "none";
    lines.push(
      `- ${lane.transportId} (${lane.commandName}): ${members}; missing baseline: ${missing}`,
    );
  }
}

function pushScenarioPackLines(lines: string[], packs: readonly QaCoverageScenarioPackSummary[]) {
  for (const pack of packs) {
    const missing =
      pack.missingScenarioIds.length > 0 ? pack.missingScenarioIds.join(", ") : "none";
    lines.push(
      `- ${pack.id} (${pack.title}): ${pack.scenarioIds.length} scenarios; feature IDs: ${pack.featureIds.join(", ")}; missing scenarios: ${missing}`,
    );
    lines.push(`  - scenarios: ${pack.scenarioIds.join(", ")}`);
  }
}

function pushScorecardTaxonomyLines(lines: string[], report: QaScorecardTaxonomyReport) {
  lines.push("## Scorecard Taxonomy", "");
  lines.push(`- Taxonomy: ${report.taxonomyPath ?? "missing"}`);
  lines.push(`- Categories: ${report.categoryCount}`);
  lines.push(`- Profiles: ${report.profileCount}`);
  lines.push(
    `- Fulfilled taxonomy categories: ${report.fulfilledCategoryCount}/${report.requiredCategoryCount} (${report.categoryFulfillmentPercent}%)`,
  );
  lines.push(
    `- Fulfilled taxonomy features: ${report.fulfilledFeatureCount}/${report.requiredFeatureCount} (${report.taxonomyFulfillmentPercent}%)`,
  );
  lines.push(`- Evidence refs: ${report.evidenceRefCount}`);
  lines.push(`- Scenario feature IDs: ${report.scenarioFeatureIdCount}`);
  lines.push(`- Unmapped scenario feature IDs: ${report.unmappedFeatureIdCount}`);
  lines.push(`- Validation warnings: ${report.validationIssueCount}`, "");

  if (report.profiles.length > 0) {
    lines.push("### Profiles", "");
    for (const profile of report.profiles) {
      const categories = profile.categoryIds.length > 0 ? profile.categoryIds.join(", ") : "none";
      lines.push(`- ${profile.id}: ${profile.categoryIds.length} categories; ${categories}`);
    }
    lines.push("");
  }

  if (report.categories.length > 0) {
    lines.push("### Category Mapping", "");
    for (const category of report.categories) {
      const features = category.featureIds.length > 0 ? category.featureIds.join(", ") : "none";
      const evidence =
        category.evidence.length > 0
          ? category.evidence
              .map((ref) => {
                const target = ref.path ?? (ref.scenarioRefs.join("|") || "discovered");
                return `${ref.role}:${ref.kind}:${target} (${ref.featureId})`;
              })
              .join(", ")
          : "none";
      const profiles = category.profiles.length > 0 ? category.profiles.join(", ") : "none";
      lines.push(
        `- ${category.id} (${category.taxonomySurfaceId} / ${category.taxonomyCategoryName}; ${category.mappingStatus}): profiles: ${profiles}; features: ${features}; evidence: ${evidence}`,
      );
    }
    lines.push("");
  }

  if (report.validationIssues.length > 0) {
    lines.push("### Validation Warnings", "");
    for (const issue of report.validationIssues) {
      const category = issue.categoryId ? `${issue.categoryId}: ` : "";
      lines.push(`- ${issue.code}: ${category}${issue.message}`);
    }
    lines.push("");
  }

  if (report.unmappedFeatureIds.length > 0) {
    lines.push("### Unmapped Scenario Feature IDs", "");
    lines.push(report.unmappedFeatureIds.join(", "));
    lines.push("");
  }
}

export function renderQaCoverageMarkdownReport(inventory: QaCoverageInventory): string {
  const lines: string[] = [
    "# QA Coverage Inventory",
    "",
    `- Scenarios: ${inventory.scenarioCount}`,
    `- Taxonomy feature IDs: ${inventory.featureIdCount}`,
    `- Primary feature IDs: ${inventory.primaryFeatureIdCount}`,
    `- Secondary feature IDs: ${inventory.secondaryFeatureIdCount}`,
    `- Overlapping feature IDs: ${inventory.overlappingCoverage.length}`,
    `- Missing coverage metadata: ${inventory.missingCoverage.length}`,
    "",
  ];

  if (inventory.scenarioPacks.length > 0) {
    lines.push("## Scenario Packs", "");
    pushScenarioPackLines(lines, inventory.scenarioPacks);
    lines.push("");
  }

  lines.push("## By Theme", "");
  for (const theme of Object.keys(inventory.byTheme).toSorted()) {
    lines.push(`### ${theme}`, "");
    pushFeatureLines(lines, inventory.byTheme[theme] ?? []);
    lines.push("");
  }

  lines.push("## By Surface", "");
  for (const surface of Object.keys(inventory.bySurface).toSorted()) {
    lines.push(`### ${surface}`, "");
    pushFeatureLines(lines, inventory.bySurface[surface] ?? []);
    lines.push("");
  }

  if (inventory.liveTransportLanes.length > 0) {
    lines.push("## Live Transport Lanes", "");
    pushLiveTransportLines(lines, inventory.liveTransportLanes);
    lines.push("");
  }

  pushScorecardTaxonomyLines(lines, inventory.scorecardTaxonomy);

  if (inventory.overlappingCoverage.length > 0) {
    lines.push("## Overlap", "");
    pushFeatureLines(lines, inventory.overlappingCoverage);
    lines.push("");
  }

  if (inventory.missingCoverage.length > 0) {
    lines.push("## Missing Metadata", "");
    for (const scenario of inventory.missingCoverage.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      lines.push(`- ${scenario.id}: ${scenario.sourcePath}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatOptionalScenarioMetadata(match: QaScenarioSearchMatch) {
  const metadata = [
    match.runtimeParityTier ? `runtimeParityTier=${match.runtimeParityTier}` : "",
    match.requiredProviderMode ? `providerMode=${match.requiredProviderMode}` : "",
    match.requiredProvider ? `provider=${match.requiredProvider}` : "",
    match.requiredModel ? `model=${match.requiredModel}` : "",
  ].filter(Boolean);
  return metadata.length > 0 ? metadata.join("; ") : "none";
}

export function renderQaScenarioMatchesMarkdownReport(params: {
  query: string;
  matches: readonly QaScenarioSearchMatch[];
}) {
  const flowMatches = params.matches.filter((match) => match.executionKind === "flow");
  const nativeMatches = params.matches.filter((match) => match.executionKind !== "flow");
  const scenarioArgs = flowMatches.map((match) => `--scenario ${match.id}`).join(" ");
  const lines = [
    "# QA Scenario Matches",
    "",
    `- Query: ${params.query}`,
    `- Matches: ${params.matches.length}`,
  ];

  if (scenarioArgs) {
    lines.push(`- Suite command: \`pnpm openclaw qa suite ${scenarioArgs}\``);
  }
  if (nativeMatches.length > 0) {
    const refs = nativeMatches
      .map((match) => `${match.executionKind}:${match.executionPath ?? "missing"} (${match.id})`)
      .join("; ");
    lines.push(`- Native test refs: ${refs}`);
  }
  lines.push("");

  if (params.matches.length === 0) {
    lines.push("No QA scenarios matched the query.", "");
    return lines.join("\n");
  }

  for (const match of params.matches) {
    lines.push(`- ${match.id}: ${match.title}`);
    lines.push(`  - source: ${match.sourcePath}`);
    lines.push(`  - surface: ${match.surfaces.join(", ")}`);
    lines.push(
      match.executionKind === "flow"
        ? "  - execution: qa-flow"
        : `  - execution: ${match.executionKind} ${match.executionPath ?? "missing"}`,
    );
    lines.push(`  - feature IDs: ${match.featureIds.join(", ") || "none"}`);
    lines.push(`  - live requirements: ${formatOptionalScenarioMetadata(match)}`);
    if (match.codeRefs.length > 0) {
      lines.push(`  - code refs: ${match.codeRefs.join(", ")}`);
    }
    if (match.docsRefs.length > 0) {
      lines.push(`  - docs refs: ${match.docsRefs.join(", ")}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
