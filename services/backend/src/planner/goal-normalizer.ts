import {
  GoalDecompositionRequest,
  AmbiguousGoalDetails,
  PLANNER_SAFETY_LIMITS,
} from '@nexusos/contracts';
import { NormalizedGoal, TaskArchetype } from './types.js';

export class GoalNormalizer {
  /**
   * Normalizes incoming user goals into a deterministic representation.
   * Fails closed with structured AMBIGUOUS_GOAL if intent cannot be safely resolved.
   */
  public normalize(request: Partial<GoalDecompositionRequest> & { goal: string }): NormalizedGoal {
    const rawGoal = request.goal ? request.goal.trim() : '';

    // 1. Detect empty or non-actionable input
    if (!rawGoal || rawGoal.length < 3 || /^[^a-zA-Z0-9]+$/.test(rawGoal)) {
      return this.createAmbiguousResult(
        rawGoal,
        'Goal description is empty or contains no actionable natural language intent.',
        ['actionableObjective'],
        ['Please specify what task or workflow you would like to perform.'],
        ['Inspect repository files', 'Search workspace for documents', 'Perform web research'],
      );
    }

    // 2. Detect overly vague or single-word ambiguous intents without subject/target
    const words = rawGoal.split(/\s+/).filter(Boolean);
    const lowercase = rawGoal.toLowerCase();

    const purelyVagueVerbs = new Set([
      'do',
      'run',
      'execute',
      'start',
      'go',
      'fix',
      'check',
      'test',
      'process',
      'make',
      'work',
      'something',
      'anything',
      'it',
    ]);

    if (
      words.length <= 2 &&
      words.every((w) => purelyVagueVerbs.has(w.toLowerCase().replace(/[^a-z]/g, '')))
    ) {
      return this.createAmbiguousResult(
        rawGoal,
        `Goal '${rawGoal}' is structurally ambiguous and specifies an action without a target object, file, or deliverable.`,
        ['targetObject', 'deliverableSpecification'],
        [
          'What specific file, directory, URL, or process should be acted upon?',
          'What is the expected outcome or deliverable?',
        ],
        [
          'Inspect code files in workspace',
          'Run test suite in terminal',
          'Read config file and summarize',
        ],
      );
    }

    // 3. Detect action without destination (e.g. "download", "clone", "visit" without URL or path)
    if (
      (lowercase.startsWith('download') ||
        lowercase.startsWith('clone') ||
        lowercase.startsWith('visit')) &&
      !lowercase.includes('http') &&
      !lowercase.includes('.com') &&
      !lowercase.includes('.org') &&
      !lowercase.includes('.git') &&
      !lowercase.includes('/') &&
      !lowercase.includes('\\') &&
      words.length < 4
    ) {
      return this.createAmbiguousResult(
        rawGoal,
        `Goal specifies '${words[0]}' but lacks a target URL, repository, or destination.`,
        ['targetUrlOrPath'],
        ['Please specify the target URL, repository URL, or local path.'],
        ['Navigate to documentation URL', 'Inspect local project files'],
      );
    }

    // 4. Neutralize adversarial prompt injection payloads (057-SEC-06)
    // Strip control token attacks while leaving underlying semantic goal inert
    const sanitizedGoal = this.sanitizeGoalText(rawGoal);

    // 5. Classify Archetype
    const archetype = this.classifyArchetype(sanitizedGoal, request.parameters);

    // 6. Extract Deliverables
    const deliverables =
      request.deliverables && request.deliverables.length > 0
        ? request.deliverables
        : this.extractDefaultDeliverables(sanitizedGoal, archetype);

    // 7. Extract Parameters
    const parameters = {
      ...request.parameters,
      ...this.extractParametersFromText(sanitizedGoal),
    };

    return {
      originalGoal: rawGoal,
      normalizedObjective: sanitizedGoal,
      deliverables,
      constraints: {
        timeoutMs: Math.min(
          Math.max(1, request.constraints?.timeoutMs ?? PLANNER_SAFETY_LIMITS.MAX_TIMEOUT_MS),
          PLANNER_SAFETY_LIMITS.MAX_TIMEOUT_MS,
        ),
        maxNodes: Math.min(
          Math.max(1, request.constraints?.maxNodes ?? PLANNER_SAFETY_LIMITS.MAX_NODES),
          PLANNER_SAFETY_LIMITS.MAX_NODES,
        ),
        requireHumanApprovalAbove: request.constraints?.requireHumanApprovalAbove ?? 'MEDIUM',
        allowedCategories: request.constraints?.allowedCategories,
        forbiddenCapabilities: request.constraints?.forbiddenCapabilities,
        budgetLimitUsd: request.constraints?.budgetLimitUsd,
      },
      archetype,
      parameters,
      isAmbiguous: false,
    };
  }

  private classifyArchetype(goal: string, _params?: Record<string, unknown>): TaskArchetype {
    const text = goal.toLowerCase();

    if (
      text.includes('browse') ||
      text.includes('web') ||
      text.includes('url') ||
      text.includes('website') ||
      text.includes('http') ||
      text.includes('scrape') ||
      text.includes('extract text from page')
    ) {
      return 'RESEARCH_AUTOMATION';
    }

    if (
      text.includes('write') ||
      text.includes('create file') ||
      text.includes('save') ||
      text.includes('modify') ||
      text.includes('transform') ||
      text.includes('convert') ||
      text.includes('generate report')
    ) {
      return 'FILE_TRANSFORMATION';
    }

    if (
      text.includes('read') ||
      text.includes('inspect') ||
      text.includes('list') ||
      text.includes('search') ||
      text.includes('find') ||
      text.includes('scan') ||
      text.includes('check file') ||
      text.includes('view')
    ) {
      return 'FILE_INSPECTION';
    }

    if (
      text.includes('pipeline') ||
      text.includes('build and test') ||
      text.includes('compile') ||
      text.includes('run tests and') ||
      text.includes('step')
    ) {
      return 'WORKFLOW_PIPELINE';
    }

    return 'GENERIC';
  }

  private extractDefaultDeliverables(_goal: string, archetype: TaskArchetype): string[] {
    switch (archetype) {
      case 'FILE_INSPECTION':
        return ['File inspection results', 'Identified file list or content summary'];
      case 'FILE_TRANSFORMATION':
        return ['Transformed output file', 'Execution status receipt'];
      case 'RESEARCH_AUTOMATION':
        return ['Extracted page content or research summary'];
      case 'WORKFLOW_PIPELINE':
        return ['Completed workflow stage receipts'];
      default:
        return ['Task completion summary'];
    }
  }

  private extractParametersFromText(goal: string): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    // Extract file path patterns (e.g. path/to/file.ext or C:\path\to\file.ext)
    const pathMatch = goal.match(
      /(?:[a-zA-Z]:[\\/]|[./\\a-zA-Z0-9_-]+[\\/])+[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+/,
    );
    if (pathMatch) {
      params['detectedPath'] = pathMatch[0];
    }

    // Extract URL patterns
    const urlMatch = goal.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      params['detectedUrl'] = urlMatch[0];
    }

    return params;
  }

  private sanitizeGoalText(text: string): string {
    // 057-SEC-06: Remove prompt injection control tokens and privilege escalation phrases
    return text
      .replace(/ignore\s+all\s+previous\s+instructions/gi, '[neutralized_prompt_injection]')
      .replace(/ignore\s+previous\s+instructions/gi, '[neutralized_prompt_injection]')
      .replace(/system\s+override[:\s]*/gi, '[neutralized_override]')
      .replace(/grant\s+admin\s+privileges?/gi, '[neutralized_escalation]')
      .replace(/bypass\s+policy/gi, '[neutralized_bypass]')
      .trim();
  }

  private createAmbiguousResult(
    goal: string,
    message: string,
    missingDeliverables: string[],
    clarificationPrompts: string[],
    suggestedAlternatives: string[],
  ): NormalizedGoal {
    const ambiguityDetails: AmbiguousGoalDetails = {
      code: 'AMBIGUOUS_GOAL',
      message,
      missingDeliverables,
      clarificationPrompts,
      suggestedAlternatives,
    };

    return {
      originalGoal: goal,
      normalizedObjective: goal,
      deliverables: [],
      constraints: {
        timeoutMs: PLANNER_SAFETY_LIMITS.MAX_TIMEOUT_MS,
        maxNodes: PLANNER_SAFETY_LIMITS.MAX_NODES,
        requireHumanApprovalAbove: 'MEDIUM',
      },
      archetype: 'GENERIC',
      parameters: {},
      isAmbiguous: true,
      ambiguityDetails,
    };
  }
}
