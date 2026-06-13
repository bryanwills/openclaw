// Qa Lab tests cover coverage report plugin behavior.
import { describe, expect, it } from "vitest";
import { buildQaCoverageInventory, renderQaCoverageMarkdownReport } from "./coverage-report.js";
import { readQaScenarioPack } from "./scenario-catalog.js";
import { buildQaScorecardTaxonomyReport, parseQaScorecardTaxonomy } from "./scorecard-taxonomy.js";

const TEST_EXECUTABLE_CATEGORY_ID = "agent-runtime-and-provider-execution.agent-turn-execution";
const TEST_BROWSER_CATEGORY_ID = "browser-control-ui-and-webchat.browser-ui";

function testScorecardProfiles(categoryId = TEST_EXECUTABLE_CATEGORY_ID, profileId = "release") {
  return [
    {
      id: "smoke-ci",
      description: "Test smoke profile.",
      categoryIds: profileId === "smoke-ci" ? [categoryId] : [],
    },
    {
      id: "release",
      description: "Test release profile.",
      categoryIds: profileId === "release" ? [categoryId] : [],
    },
  ];
}

function testScorecardTaxonomy(opts: {
  categoryId?: string;
  profileId?: string;
  evidence?: readonly unknown[];
}) {
  const categoryId = opts.categoryId ?? TEST_EXECUTABLE_CATEGORY_ID;
  return parseQaScorecardTaxonomy({
    version: 1,
    title: "Test taxonomy",
    profiles: testScorecardProfiles(categoryId, opts.profileId ?? "release"),
    categories: [
      {
        id: categoryId,
        evidence: opts.evidence ?? [
          {
            coverageId: "channels.dm",
            kind: "qa-scenario",
          },
        ],
      },
    ],
  });
}

describe("qa coverage report", () => {
  it("groups scenario coverage metadata by theme and surface", () => {
    const inventory = buildQaCoverageInventory(readQaScenarioPack().scenarios);

    expect(inventory.scenarioCount).toBeGreaterThan(0);
    expect(inventory.coverageIdCount).toBeGreaterThan(0);
    expect(inventory.primaryCoverageIdCount).toBeGreaterThan(0);
    expect(inventory.secondaryCoverageIdCount).toBeGreaterThan(0);
    expect(inventory.overlappingCoverage.length).toBeGreaterThan(0);
    expect(inventory.missingCoverage).toStrictEqual([]);
    expect(inventory.liveTransportLanes.map((lane) => lane.transportId)).toEqual([
      "discord",
      "slack",
      "telegram",
      "whatsapp",
    ]);
    expect(inventory.scorecardTaxonomy.profileCount).toBe(2);
    expect(inventory.scorecardTaxonomy.categoryCount).toBe(16);
    expect(inventory.scorecardTaxonomy.requiredCategoryCount).toBe(15);
    expect(inventory.scorecardTaxonomy.fulfilledCategoryCount).toBeGreaterThan(0);
    expect(inventory.scorecardTaxonomy.taxonomyFulfillmentPercent).toBeGreaterThan(0);
    expect(inventory.scorecardTaxonomy.evidenceRefCount).toBeGreaterThan(0);
    expect(inventory.scorecardTaxonomy.mappedCoverageIdCount).toBeGreaterThan(0);
    expect(inventory.scorecardTaxonomy.mappedCoverageIdPercent).toBeGreaterThan(0);
    expect(inventory.scorecardTaxonomy.unmappedCoverageIdCount).toBeGreaterThan(0);
    expect(inventory.scorecardTaxonomy.validationIssues.length).toBeGreaterThan(0);
    expect(
      inventory.scorecardTaxonomy.validationIssues.every(
        (issue) => issue.code === "coverage-id-missing-primary-evidence",
      ),
    ).toBe(true);
    expect(
      inventory.scorecardTaxonomy.profiles
        .find((profile) => profile.id === "release")
        ?.categoryIds.toSorted(),
    ).toEqual([
      "agent-runtime-and-provider-execution.agent-turn-execution",
      "automation-cron-hooks-tasks-polling.cron-jobs",
      "browser-automation-and-exec-sandbox-tools.tool-invocation-and-execution",
      "browser-control-ui-and-webchat.browser-ui",
      "media-understanding-and-media-generation.media-generation",
      "media-understanding-and-media-generation.media-understanding",
      "openai-codex-provider-path.responses-and-tool-compatibility",
      "plugin-sdk-and-bundled-plugin-architecture.installing-and-running-plugins",
      "security-auth-pairing-and-secrets.approval-policy-and-tool-safeguards",
      "security-auth-pairing-and-secrets.credential-and-secret-hygiene",
      "session-memory-and-context-engine.diagnostics-maintenance-and-recovery",
      "session-memory-and-context-engine.memory",
      "session-memory-and-context-engine.token-management",
      "telemetry-diagnostics-and-observability.telemetry-export",
    ]);
    expect(
      inventory.scorecardTaxonomy.categories.find(
        (category) => category.id === "browser-control-ui-and-webchat.browser-ui",
      )?.evidence,
    ).toContainEqual({
      coverageId: "ui.control",
      kind: "playwright",
      path: "ui/src/ui/e2e/chat-flow.e2e.test.ts",
      role: "explicit",
      scenarioRefs: [],
    });
    expect(inventory.scenarioPacks.map((pack) => pack.id)).toEqual([
      "observability",
      "personal-agent",
    ]);
    const personalPack = inventory.scenarioPacks.find((pack) => pack.id === "personal-agent");
    const observabilityPack = inventory.scenarioPacks.find((pack) => pack.id === "observability");
    expect(personalPack?.missingScenarioIds).toStrictEqual([]);
    expect(personalPack?.scenarioIds).toContain("personal-share-safe-diagnostics-artifact");
    expect(personalPack?.coverageIds).toContain("personal.redaction");
    expect(personalPack?.coverageIds).toContain("qa.artifact-safety");
    expect(observabilityPack?.missingScenarioIds).toStrictEqual([]);
    expect(observabilityPack?.scenarioIds).toEqual(["otel-trace-smoke", "docker-prometheus-smoke"]);
    expect(observabilityPack?.coverageIds).toContain("telemetry.otel");
    expect(observabilityPack?.coverageIds).toContain("telemetry.prometheus");
    expect(inventory.byTheme.memory.map((feature) => feature.id)).toContain("memory.recall");
    expect(inventory.bySurface.memory.map((feature) => feature.id)).toContain("memory.recall");
  });

  it("renders a compact markdown inventory", () => {
    const report = renderQaCoverageMarkdownReport(
      buildQaCoverageInventory(readQaScenarioPack().scenarios),
    );

    expect(report).toContain("# QA Coverage Inventory");
    expect(report).toContain("- Missing coverage metadata: 0");
    expect(report).toContain("- Overlapping coverage IDs:");
    expect(report).toContain("memory.recall");
    expect(report).toContain("primary: memory-recall (qa/scenarios/memory/memory-recall.md)");
    expect(report).toContain("secondary: active-memory-preprompt-recall");
    expect(report).toContain("## Scenario Packs");
    expect(report).toContain(
      "- personal-agent (Personal Agent Benchmark Pack): 10 scenarios; coverage:",
    );
    expect(report).toContain("- observability (Observability Smoke Pack): 2 scenarios; coverage:");
    expect(report).toContain("otel-trace-smoke, docker-prometheus-smoke");
    expect(report).toContain("personal-share-safe-diagnostics-artifact");
    expect(report).toContain("## Live Transport Lanes");
    expect(report).toContain(
      "- telegram (telegram): canary: always-on, help-command: telegram-help-command, mention-gating: telegram-mention-gating; missing baseline: allowlist-block, top-level-reply-shape, restart-resume",
    );
    expect(report).toContain("thread-follow-up: slack-thread-follow-up");
    expect(report).toContain("## Scorecard Taxonomy");
    expect(report).toContain("- Mapping: taxonomy-mappings.yaml");
    expect(report).toContain("- Maturity taxonomy: taxonomy.yaml");
    expect(report).toContain("- Fulfilled taxonomy categories:");
    expect(report).toContain("- Evidence refs:");
    expect(report).toContain("- Mapped QA coverage IDs:");
    expect(report).toContain(
      "- browser-automation-and-exec-sandbox-tools.tool-invocation-and-execution (browser-automation-and-exec-sandbox-tools / Tool Invocation and Execution; mapped): profiles: release, smoke-ci; coverage: tools.apply-patch, tools.exec, tools.fs.read, tools.fs.write, tools.web-search;",
    );
    expect(report).toContain(
      "explicit:playwright:ui/src/ui/e2e/chat-flow.e2e.test.ts (ui.control)",
    );
    expect(report).toContain("### Unmapped Coverage IDs");
    expect(report).toContain("agents.subagents");
  });

  it("reports taxonomy evidence gaps without treating missing coverage as fulfilled", () => {
    const taxonomy = testScorecardTaxonomy({
      evidence: [
        {
          coverageId: "runtime.missing-coverage",
          kind: "qa-scenario",
        },
        {
          coverageId: "runtime.delivery",
          kind: "vitest",
          path: "missing-scorecard-evidence.test.ts",
        },
      ],
    });

    const report = buildQaScorecardTaxonomyReport({
      taxonomy,
      repoRoot: process.cwd(),
      scenarios: readQaScenarioPack().scenarios,
    });

    expect(report.mappedCoverageIdCount).toBe(0);
    expect(report.categories[0]?.mappingStatus).toBe("partial");
    expect(report.validationIssues.map((issue) => issue.code)).toEqual([
      "coverage-id-not-found",
      "evidence-ref-not-found",
    ]);
  });

  it("uses explicit native test evidence as category fulfillment", () => {
    const taxonomy = testScorecardTaxonomy({
      categoryId: TEST_BROWSER_CATEGORY_ID,
      evidence: [
        {
          coverageId: "ui.control",
          kind: "playwright",
          path: "ui/src/ui/e2e/chat-flow.e2e.test.ts",
        },
      ],
    });

    const report = buildQaScorecardTaxonomyReport({
      taxonomy,
      repoRoot: process.cwd(),
      scenarios: readQaScenarioPack().scenarios,
    });

    expect(report.validationIssues).toStrictEqual([]);
    expect(report.fulfilledCategoryCount).toBe(1);
    expect(report.categories[0]?.mappingStatus).toBe("mapped");
    expect(report.categories[0]?.scenarioRefs).toStrictEqual([]);
    expect(report.categories[0]?.evidence).toStrictEqual([
      {
        coverageId: "ui.control",
        kind: "playwright",
        path: "ui/src/ui/e2e/chat-flow.e2e.test.ts",
        role: "explicit",
        scenarioRefs: [],
      },
    ]);
  });

  it("reports executable category refs missing from taxonomy.yaml", () => {
    const taxonomy = testScorecardTaxonomy({
      categoryId: "agent-runtime-and-provider-execution.missing-taxonomy-category",
    });

    const report = buildQaScorecardTaxonomyReport({
      taxonomy,
      repoRoot: process.cwd(),
      scenarios: readQaScenarioPack().scenarios,
    });

    expect(report.validationIssues.map((issue) => issue.code)).toEqual([
      "taxonomy-category-ref-not-found",
    ]);
  });

  it("reports profile membership refs missing from mapped categories", () => {
    const taxonomy = parseQaScorecardTaxonomy({
      version: 1,
      title: "Test taxonomy",
      profiles: [
        {
          id: "smoke-ci",
          description: "Test smoke profile.",
          categoryIds: ["missing.category"],
        },
        {
          id: "release",
          description: "Test release profile.",
          categoryIds: [],
        },
      ],
      categories: [
        {
          id: TEST_EXECUTABLE_CATEGORY_ID,
          evidence: [],
        },
      ],
    });

    const report = buildQaScorecardTaxonomyReport({
      taxonomy,
      repoRoot: process.cwd(),
      scenarios: readQaScenarioPack().scenarios,
    });

    expect(report.validationIssues.map((issue) => issue.code)).toEqual([
      "profile-category-ref-not-found",
    ]);
  });

  it("reports profile categories missing executable evidence", () => {
    const taxonomy = testScorecardTaxonomy({ evidence: [] });

    const report = buildQaScorecardTaxonomyReport({
      taxonomy,
      repoRoot: process.cwd(),
      scenarios: readQaScenarioPack().scenarios,
    });

    expect(report.validationIssues.map((issue) => issue.code)).toEqual([
      "profile-category-missing-evidence",
    ]);
  });

  it("rejects native test evidence refs outside the repository", () => {
    expect(() =>
      testScorecardTaxonomy({
        evidence: [
          {
            coverageId: "runtime.delivery",
            kind: "playwright",
            path: "../outside-openclaw.test.ts",
          },
        ],
      }),
    ).toThrow("repo refs must not be absolute or contain parent-directory segments");
  });

  it("uses path-pinned qa-scenario evidence as runnable scenario evidence", () => {
    const taxonomy = testScorecardTaxonomy({
      evidence: [
        {
          coverageId: "channels.dm",
          kind: "qa-scenario",
          path: "qa/scenarios/channels/dm-chat-baseline.md",
        },
      ],
    });

    const report = buildQaScorecardTaxonomyReport({
      taxonomy,
      repoRoot: process.cwd(),
      scenarios: readQaScenarioPack().scenarios,
    });

    expect(report.validationIssues).toStrictEqual([]);
    expect(report.categories[0]?.scenarioRefs).toStrictEqual([
      "qa/scenarios/channels/dm-chat-baseline.md",
    ]);
    expect(report.categories[0]?.evidence).toStrictEqual([
      {
        coverageId: "channels.dm",
        kind: "qa-scenario",
        path: "qa/scenarios/channels/dm-chat-baseline.md",
        role: "primary",
        scenarioRefs: ["qa/scenarios/channels/dm-chat-baseline.md"],
      },
    ]);
  });
});
