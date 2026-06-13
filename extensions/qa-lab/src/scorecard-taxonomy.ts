// Qa Lab plugin module validates the scorecard evidence mapping overlay.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { QaSeedScenarioWithSource } from "./scenario-catalog.js";

export const QA_SCORECARD_TAXONOMY_PATH = "taxonomy-mappings.yaml";
export const QA_MATURITY_TAXONOMY_PATH = "taxonomy.yaml";

const qaScorecardIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, {
    message: "scorecard and coverage ids must use lowercase dotted or dashed tokens",
  });

function isRepoRootRelativeRef(value: string) {
  return !path.isAbsolute(value) && value.split(/[\\/]+/u).every((part) => part !== "..");
}

const qaScorecardRepoRefSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9._/-]+$/, {
    message: "repo refs must be repo-root relative paths",
  })
  .refine(isRepoRootRelativeRef, {
    message: "repo refs must not be absolute or contain parent-directory segments",
  });

const qaScorecardEvidenceKindSchema = z.enum([
  "qa-scenario",
  "vitest",
  "playwright",
  "live-transport-check",
]);

const qaScorecardEvidenceSchema = z
  .object({
    coverageId: qaScorecardIdSchema,
    kind: qaScorecardEvidenceKindSchema,
    path: qaScorecardRepoRefSchema.optional(),
  })
  .strict()
  .superRefine((evidence, ctx) => {
    if (evidence.kind !== "qa-scenario" && !evidence.path) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["path"],
        message: `${evidence.kind} evidence must include a repo-root relative path`,
      });
    }
  });

const qaScorecardProfileSchema = z.object({
  id: qaScorecardIdSchema,
  description: z.string().trim().min(1),
  categoryIds: z.array(qaScorecardIdSchema).default([]),
});

const qaScorecardCategorySchema = z.object({
  id: qaScorecardIdSchema,
  evidence: z.array(qaScorecardEvidenceSchema).default([]),
});

const qaScorecardTaxonomySchema = z
  .object({
    version: z.literal(1),
    title: z.string().trim().min(1),
    profiles: z.array(qaScorecardProfileSchema).min(1),
    categories: z.array(qaScorecardCategorySchema).min(1),
  })
  .strict()
  .superRefine((taxonomy, ctx) => {
    const seenProfileIds = new Set<string>();
    for (const [profileIndex, profile] of taxonomy.profiles.entries()) {
      if (seenProfileIds.has(profile.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profiles", profileIndex, "id"],
          message: `duplicate scorecard profile id: ${profile.id}`,
        });
      }
      seenProfileIds.add(profile.id);

      const seenProfileCategoryIds = new Set<string>();
      for (const [categoryIndex, categoryId] of profile.categoryIds.entries()) {
        if (seenProfileCategoryIds.has(categoryId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["profiles", profileIndex, "categoryIds", categoryIndex],
            message: `duplicate category id in profile ${profile.id}: ${categoryId}`,
          });
        }
        seenProfileCategoryIds.add(categoryId);
      }
    }

    const seenCategoryIds = new Set<string>();
    for (const [categoryIndex, category] of taxonomy.categories.entries()) {
      if (seenCategoryIds.has(category.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["categories", categoryIndex, "id"],
          message: `duplicate scorecard category id: ${category.id}`,
        });
      }
      seenCategoryIds.add(category.id);

      const seenEvidenceRefs = new Set<string>();
      for (const [evidenceIndex, evidence] of category.evidence.entries()) {
        const evidenceKey = [evidence.coverageId, evidence.kind, evidence.path ?? ""].join("\0");
        if (seenEvidenceRefs.has(evidenceKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["categories", categoryIndex, "evidence", evidenceIndex],
            message: `duplicate evidence ref in category ${category.id}: ${evidence.coverageId}/${evidence.kind}`,
          });
        }
        seenEvidenceRefs.add(evidenceKey);
      }
    }
  });

const qaMaturityCategorySchema = z.object({
  id: qaScorecardIdSchema.optional(),
  name: z.string().trim().min(1),
});

const qaMaturitySurfaceSchema = z.object({
  id: qaScorecardIdSchema,
  name: z.string().trim().min(1),
  level: z.string().trim().min(1).optional(),
  level_code: z.string().trim().min(1).optional(),
  categories: z.array(qaMaturityCategorySchema).default([]),
});

const qaMaturityTaxonomySchema = z.object({
  version: z.number(),
  title: z.string().trim().min(1),
  surfaces: z.array(qaMaturitySurfaceSchema).default([]),
});

export type QaScorecardTaxonomy = z.infer<typeof qaScorecardTaxonomySchema>;
export type QaScorecardEvidenceKind = z.infer<typeof qaScorecardEvidenceKindSchema>;
type QaMaturityTaxonomy = z.infer<typeof qaMaturityTaxonomySchema>;

export type QaScorecardValidationIssueCode =
  | "coverage-id-missing-primary-evidence"
  | "coverage-id-not-found"
  | "evidence-ref-coverage-mismatch"
  | "evidence-ref-not-found"
  | "taxonomy-ref-not-found"
  | "taxonomy-category-ref-not-found"
  | "profile-category-ref-not-found"
  | "mapped-category-missing-profile-membership"
  | "profile-category-missing-evidence"
  | "taxonomy-fixture-not-found";

export type QaScorecardValidationIssue = {
  code: QaScorecardValidationIssueCode;
  severity: "warning";
  categoryId?: string;
  ref?: string;
  message: string;
};

export type QaScorecardEvidenceReport = {
  coverageId: string;
  kind: QaScorecardEvidenceKind;
  path: string | null;
  role: "primary" | "secondary" | "explicit";
  scenarioRefs: string[];
};

export type QaScorecardCategoryMappingReport = {
  id: string;
  taxonomySurfaceId: string;
  taxonomyCategoryName: string;
  mappingStatus: "mapped" | "partial" | "missing";
  profiles: string[];
  coverageIds: string[];
  evidence: QaScorecardEvidenceReport[];
  scenarioRefs: string[];
  missingCoverageIds: string[];
  missingEvidenceRefs: string[];
};

export type QaScorecardProfileReport = {
  id: string;
  categoryIds: string[];
};

export type QaScorecardTaxonomyReport = {
  taxonomyPath: string | null;
  title: string | null;
  taxonomy: {
    sourcePath: string;
  } | null;
  profileCount: number;
  profiles: QaScorecardProfileReport[];
  categoryCount: number;
  requiredCategoryCount: number;
  fulfilledCategoryCount: number;
  taxonomyFulfillmentPercent: number;
  evidenceRefCount: number;
  mappedCoverageIdCount: number;
  mappedCoverageIdPercent: number;
  unmappedCoverageIdCount: number;
  unmappedCoverageIds: string[];
  validationIssueCount: number;
  validationIssues: QaScorecardValidationIssue[];
  categories: QaScorecardCategoryMappingReport[];
};

type MaturityCategoryRef = {
  surfaceId: string;
  categoryName: string;
};

function walkUpDirectories(start: string): string[] {
  const roots: string[] = [];
  let current = path.resolve(start);
  while (true) {
    roots.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      return roots;
    }
    current = parent;
  }
}

function resolveRepoPath(relativePath: string, kind: "file" | "directory" = "file") {
  for (const dir of walkUpDirectories(import.meta.dirname)) {
    const candidate = path.join(dir, relativePath);
    if (!fs.existsSync(candidate)) {
      continue;
    }
    const stat = fs.statSync(candidate);
    if ((kind === "file" && stat.isFile()) || (kind === "directory" && stat.isDirectory())) {
      return candidate;
    }
  }
  return null;
}

function repoRootFromMappingPath(mappingPath: string) {
  return path.dirname(mappingPath);
}

function formatZodIssuePath(pathLocal: PropertyKey[]) {
  return pathLocal.length ? pathLocal.map(String).join(".") : "<root>";
}

export function parseQaScorecardTaxonomy(value: unknown, label = QA_SCORECARD_TAXONOMY_PATH) {
  const parsed = qaScorecardTaxonomySchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  const issues = parsed.error.issues
    .map((issue) => `${formatZodIssuePath(issue.path)}: ${issue.message}`)
    .join("; ");
  throw new Error(`${label}: ${issues}`);
}

export function readQaScorecardTaxonomy(): QaScorecardTaxonomy | null {
  const taxonomyPath = resolveRepoPath(QA_SCORECARD_TAXONOMY_PATH, "file");
  if (!taxonomyPath) {
    return null;
  }
  return parseQaScorecardTaxonomy(
    YAML.parse(fs.readFileSync(taxonomyPath, "utf8")) as unknown,
    QA_SCORECARD_TAXONOMY_PATH,
  );
}

function parseQaMaturityTaxonomy(value: unknown, label = QA_MATURITY_TAXONOMY_PATH) {
  const parsed = qaMaturityTaxonomySchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  const issues = parsed.error.issues
    .map((issue) => `${formatZodIssuePath(issue.path)}: ${issue.message}`)
    .join("; ");
  throw new Error(`${label}: ${issues}`);
}

function readQaMaturityTaxonomy(repoRoot: string | undefined) {
  const taxonomyPath = repoRoot
    ? path.join(repoRoot, QA_MATURITY_TAXONOMY_PATH)
    : resolveRepoPath(QA_MATURITY_TAXONOMY_PATH);
  if (!taxonomyPath || !fs.existsSync(taxonomyPath)) {
    return null;
  }
  return parseQaMaturityTaxonomy(
    YAML.parse(fs.readFileSync(taxonomyPath, "utf8")) as unknown,
    QA_MATURITY_TAXONOMY_PATH,
  );
}

function maturityCategoryId(surfaceId: string, category: { id?: string; name: string }) {
  return `${surfaceId}.${category.id}`;
}

function buildMaturityCategoryRefs(taxonomy: QaMaturityTaxonomy | null) {
  const refs = new Map<string, MaturityCategoryRef>();
  if (!taxonomy) {
    return refs;
  }
  for (const surface of taxonomy.surfaces) {
    for (const category of surface.categories) {
      if (!category.id) {
        continue;
      }
      refs.set(maturityCategoryId(surface.id, category), {
        surfaceId: surface.id,
        categoryName: category.name,
      });
    }
  }
  return refs;
}

function pathExists(repoRoot: string | undefined, relativePath: string) {
  if (!isRepoRootRelativeRef(relativePath)) {
    return false;
  }
  return repoRoot ? fs.existsSync(path.join(repoRoot, relativePath)) : true;
}

function scenarioCoverageIds(scenario: QaSeedScenarioWithSource) {
  return [...(scenario.coverage?.primary ?? []), ...(scenario.coverage?.secondary ?? [])];
}

function collectScenarioRefsByCoverageId(params: {
  scenarios: readonly QaSeedScenarioWithSource[];
  role: "primary" | "secondary";
}) {
  const refsByCoverageId = new Map<string, Set<string>>();
  for (const scenario of params.scenarios) {
    const coverageIds =
      params.role === "primary"
        ? (scenario.coverage?.primary ?? [])
        : (scenario.coverage?.secondary ?? []);
    for (const coverageId of coverageIds) {
      const refs = refsByCoverageId.get(coverageId) ?? new Set<string>();
      refs.add(scenario.sourcePath);
      refsByCoverageId.set(coverageId, refs);
    }
  }
  return refsByCoverageId;
}

function uniqueSorted(values: Iterable<string>) {
  return [...new Set(values)].toSorted((left, right) => left.localeCompare(right));
}

function percent(part: number, total: number) {
  return total === 0 ? 0 : Number(((part / total) * 100).toFixed(1));
}

export function buildQaScorecardTaxonomyReport(params: {
  taxonomy: QaScorecardTaxonomy | null;
  taxonomyPath?: string | null;
  repoRoot?: string;
  scenarios: readonly QaSeedScenarioWithSource[];
}): QaScorecardTaxonomyReport {
  if (!params.taxonomy) {
    const issue = {
      code: "taxonomy-fixture-not-found",
      severity: "warning",
      ref: QA_SCORECARD_TAXONOMY_PATH,
      message: `Scorecard evidence mapping not found at ${QA_SCORECARD_TAXONOMY_PATH}`,
    } satisfies QaScorecardValidationIssue;
    return {
      taxonomyPath: params.taxonomyPath ?? null,
      title: null,
      taxonomy: null,
      profileCount: 0,
      profiles: [],
      categoryCount: 0,
      requiredCategoryCount: 0,
      fulfilledCategoryCount: 0,
      taxonomyFulfillmentPercent: 0,
      evidenceRefCount: 0,
      mappedCoverageIdCount: 0,
      mappedCoverageIdPercent: 0,
      unmappedCoverageIdCount: 0,
      unmappedCoverageIds: [],
      validationIssueCount: 1,
      validationIssues: [issue],
      categories: [],
    };
  }

  const primaryScenarioRefsByCoverageId = collectScenarioRefsByCoverageId({
    scenarios: params.scenarios,
    role: "primary",
  });
  const secondaryScenarioRefsByCoverageId = collectScenarioRefsByCoverageId({
    scenarios: params.scenarios,
    role: "secondary",
  });
  const scenariosByRef = new Map(
    params.scenarios.map((scenario) => [scenario.sourcePath, scenario] as const),
  );
  const issues: QaScorecardValidationIssue[] = [];
  const categories: QaScorecardCategoryMappingReport[] = [];
  const mappedCoverageIds = new Set<string>();
  const categoryIds = new Set(params.taxonomy.categories.map((category) => category.id));
  const maturityTaxonomy = readQaMaturityTaxonomy(params.repoRoot);
  const maturityCategoryRefs = buildMaturityCategoryRefs(maturityTaxonomy);
  const profileCategoryIdsByCategoryId = new Map<string, Set<string>>();

  const profiles = params.taxonomy.profiles.map((profile) => {
    for (const categoryId of profile.categoryIds) {
      if (!categoryIds.has(categoryId)) {
        issues.push({
          code: "profile-category-ref-not-found",
          severity: "warning",
          ref: categoryId,
          message: `${profile.id} profile references missing scorecard category ${categoryId}`,
        });
        continue;
      }
      const profileIds = profileCategoryIdsByCategoryId.get(categoryId) ?? new Set<string>();
      profileIds.add(profile.id);
      profileCategoryIdsByCategoryId.set(categoryId, profileIds);
    }

    return {
      id: profile.id,
      categoryIds: profile.categoryIds.filter((categoryId) => categoryIds.has(categoryId)),
    };
  });

  if (!pathExists(params.repoRoot, QA_MATURITY_TAXONOMY_PATH) || !maturityTaxonomy) {
    issues.push({
      code: "taxonomy-ref-not-found",
      severity: "warning",
      ref: QA_MATURITY_TAXONOMY_PATH,
      message: `Scorecard mapping references missing maturity taxonomy ${QA_MATURITY_TAXONOMY_PATH}`,
    });
  }

  for (const category of params.taxonomy.categories) {
    const evidenceReports: QaScorecardEvidenceReport[] = [];
    const missingCoverageIds: string[] = [];
    const missingEvidenceRefs: string[] = [];
    const categoryCoverageIds = new Set<string>();
    const categoryScenarioRefs = new Set<string>();
    const coverageIdsWithFulfillment = new Set<string>();
    const coverageIdsWithResolvedEvidence = new Set<string>();
    const coverageIdsWithSecondaryEvidence = new Set<string>();
    const partialCoverageIds = new Set<string>();
    const membershipProfileIds =
      profileCategoryIdsByCategoryId.get(category.id) ?? new Set<string>();
    const sortedMembershipProfileIds = uniqueSorted(membershipProfileIds);
    const maturityRef = maturityCategoryRefs.get(category.id);

    if (maturityTaxonomy && !maturityRef) {
      issues.push({
        code: "taxonomy-category-ref-not-found",
        severity: "warning",
        categoryId: category.id,
        ref: category.id,
        message: `${category.id} does not match a maturity taxonomy category`,
      });
    }

    for (const evidence of category.evidence) {
      categoryCoverageIds.add(evidence.coverageId);

      if (evidence.kind === "qa-scenario") {
        if (evidence.path) {
          const scenario = scenariosByRef.get(evidence.path);
          if (!scenario) {
            missingEvidenceRefs.push(evidence.path);
            issues.push({
              code: "evidence-ref-not-found",
              severity: "warning",
              categoryId: category.id,
              ref: evidence.path,
              message: `${category.id} references missing QA scenario evidence ${evidence.path}`,
            });
            continue;
          }

          const primaryCoverage = scenario.coverage?.primary ?? [];
          const secondaryCoverage = scenario.coverage?.secondary ?? [];
          const isPrimary = primaryCoverage.includes(evidence.coverageId);
          const isSecondary = secondaryCoverage.includes(evidence.coverageId);
          if (!isPrimary && !isSecondary) {
            partialCoverageIds.add(evidence.coverageId);
            issues.push({
              code: "evidence-ref-coverage-mismatch",
              severity: "warning",
              categoryId: category.id,
              ref: evidence.path,
              message: `${category.id} maps ${evidence.path}, but that QA scenario does not declare coverage id ${evidence.coverageId}`,
            });
            continue;
          }

          coverageIdsWithResolvedEvidence.add(evidence.coverageId);
          categoryScenarioRefs.add(evidence.path);
          if (isPrimary) {
            coverageIdsWithFulfillment.add(evidence.coverageId);
            mappedCoverageIds.add(evidence.coverageId);
          } else {
            coverageIdsWithSecondaryEvidence.add(evidence.coverageId);
          }
          evidenceReports.push({
            coverageId: evidence.coverageId,
            kind: evidence.kind,
            path: evidence.path,
            role: isPrimary ? "primary" : "secondary",
            scenarioRefs: [evidence.path],
          });
          continue;
        }

        const primaryRefs = primaryScenarioRefsByCoverageId.get(evidence.coverageId) ?? new Set();
        const secondaryRefs =
          secondaryScenarioRefsByCoverageId.get(evidence.coverageId) ?? new Set();
        const scenarioRefs = uniqueSorted([...primaryRefs, ...secondaryRefs]);
        if (scenarioRefs.length === 0) {
          missingCoverageIds.push(evidence.coverageId);
          issues.push({
            code: "coverage-id-not-found",
            severity: "warning",
            categoryId: category.id,
            ref: evidence.coverageId,
            message: `${category.id} maps missing QA scenario coverage id ${evidence.coverageId}`,
          });
          continue;
        }

        coverageIdsWithResolvedEvidence.add(evidence.coverageId);
        if (primaryRefs.size > 0) {
          coverageIdsWithFulfillment.add(evidence.coverageId);
          mappedCoverageIds.add(evidence.coverageId);
          for (const scenarioRef of primaryRefs) {
            categoryScenarioRefs.add(scenarioRef);
          }
        } else {
          coverageIdsWithSecondaryEvidence.add(evidence.coverageId);
        }

        evidenceReports.push({
          coverageId: evidence.coverageId,
          kind: evidence.kind,
          path: null,
          role: primaryRefs.size > 0 ? "primary" : "secondary",
          scenarioRefs,
        });
        continue;
      }

      if (!evidence.path || !pathExists(params.repoRoot, evidence.path)) {
        const ref = evidence.path ?? `${evidence.kind}:${evidence.coverageId}`;
        missingEvidenceRefs.push(ref);
        issues.push({
          code: "evidence-ref-not-found",
          severity: "warning",
          categoryId: category.id,
          ref,
          message: `${category.id} references missing ${evidence.kind} evidence ${ref}`,
        });
        continue;
      }

      mappedCoverageIds.add(evidence.coverageId);
      coverageIdsWithFulfillment.add(evidence.coverageId);
      coverageIdsWithResolvedEvidence.add(evidence.coverageId);
      evidenceReports.push({
        coverageId: evidence.coverageId,
        kind: evidence.kind,
        path: evidence.path,
        role: "explicit",
        scenarioRefs: [],
      });
    }

    for (const coverageId of categoryCoverageIds) {
      if (
        coverageIdsWithResolvedEvidence.has(coverageId) &&
        coverageIdsWithSecondaryEvidence.has(coverageId) &&
        !coverageIdsWithFulfillment.has(coverageId)
      ) {
        partialCoverageIds.add(coverageId);
        issues.push({
          code: "coverage-id-missing-primary-evidence",
          severity: "warning",
          categoryId: category.id,
          ref: coverageId,
          message: `${category.id} maps ${coverageId}, but QA scenarios only list it as secondary coverage`,
        });
      }
    }

    if (membershipProfileIds.size === 0 && category.evidence.length > 0) {
      issues.push({
        code: "mapped-category-missing-profile-membership",
        severity: "warning",
        categoryId: category.id,
        message: `${category.id} maps evidence but is not selected by any profile`,
      });
    } else if (membershipProfileIds.size > 0 && category.evidence.length === 0) {
      issues.push({
        code: "profile-category-missing-evidence",
        severity: "warning",
        categoryId: category.id,
        message: `${category.id} is selected by a runnable profile but has no evidence`,
      });
    }

    const mappingStatus =
      category.evidence.length === 0
        ? "missing"
        : missingCoverageIds.length > 0 ||
            missingEvidenceRefs.length > 0 ||
            partialCoverageIds.size > 0
          ? "partial"
          : "mapped";

    categories.push({
      id: category.id,
      taxonomySurfaceId: maturityRef?.surfaceId ?? category.id.split(".")[0] ?? category.id,
      taxonomyCategoryName: maturityRef?.categoryName ?? category.id,
      mappingStatus,
      profiles: sortedMembershipProfileIds,
      coverageIds: uniqueSorted(categoryCoverageIds),
      evidence: evidenceReports.toSorted((left, right) =>
        `${left.coverageId}:${left.kind}:${left.path ?? ""}`.localeCompare(
          `${right.coverageId}:${right.kind}:${right.path ?? ""}`,
        ),
      ),
      scenarioRefs: uniqueSorted(categoryScenarioRefs),
      missingCoverageIds: uniqueSorted(missingCoverageIds),
      missingEvidenceRefs: uniqueSorted(missingEvidenceRefs),
    });
  }

  const sortedCategories = categories.toSorted((left, right) => left.id.localeCompare(right.id));
  const requiredCategories = sortedCategories.filter((category) => category.profiles.length > 0);
  const fulfilledCategoryCount = requiredCategories.filter(
    (category) => category.mappingStatus === "mapped",
  ).length;
  const allScenarioCoverageIds = params.scenarios.flatMap(scenarioCoverageIds);
  const allCoverageIds = uniqueSorted([...allScenarioCoverageIds, ...mappedCoverageIds]);
  const unmappedCoverageIds = allCoverageIds.filter(
    (coverageId) => !mappedCoverageIds.has(coverageId),
  );

  return {
    taxonomyPath: params.taxonomyPath ?? QA_SCORECARD_TAXONOMY_PATH,
    title: params.taxonomy.title,
    taxonomy: {
      sourcePath: QA_MATURITY_TAXONOMY_PATH,
    },
    profileCount: params.taxonomy.profiles.length,
    profiles,
    categoryCount: params.taxonomy.categories.length,
    requiredCategoryCount: requiredCategories.length,
    fulfilledCategoryCount,
    taxonomyFulfillmentPercent: percent(fulfilledCategoryCount, requiredCategories.length),
    evidenceRefCount: sortedCategories.reduce(
      (count, category) => count + category.evidence.length,
      0,
    ),
    mappedCoverageIdCount: mappedCoverageIds.size,
    mappedCoverageIdPercent: percent(mappedCoverageIds.size, allCoverageIds.length),
    unmappedCoverageIdCount: unmappedCoverageIds.length,
    unmappedCoverageIds,
    validationIssueCount: issues.length,
    validationIssues: issues,
    categories: sortedCategories,
  };
}

export function readQaScorecardTaxonomyReport(scenarios: readonly QaSeedScenarioWithSource[]) {
  const taxonomyPath = resolveRepoPath(QA_SCORECARD_TAXONOMY_PATH, "file");
  const taxonomy = readQaScorecardTaxonomy();
  return buildQaScorecardTaxonomyReport({
    taxonomy,
    taxonomyPath: taxonomyPath ? QA_SCORECARD_TAXONOMY_PATH : null,
    repoRoot: taxonomyPath ? repoRootFromMappingPath(taxonomyPath) : undefined,
    scenarios,
  });
}
