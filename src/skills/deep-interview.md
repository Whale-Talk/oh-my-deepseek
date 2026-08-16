---
name: deep-interview
description: Socratic deep interview with mathematical ambiguity gating before execution. Ask the user one question at a time to expose hidden assumptions, score clarity across weighted dimensions each round, and refuse to proceed until ambiguity drops below the threshold. Use when the user has a vague idea ("interview me", "don't assume", "make sure you understand", "ouroboros", "I have a vague idea", "not sure exactly what I want"). Do NOT use for a detailed request with file paths or acceptance criteria.
whenToUse: Use for vague requirements gathering before implementation; prefer direct execution for a detailed, specific request.
---

# Deep Interview

Deep Interview implements Ouroboros-inspired Socratic questioning with mathematical ambiguity scoring. It replaces vague ideas with crystal-clear specifications by asking targeted questions that expose hidden assumptions, measuring clarity across weighted dimensions, and refusing to proceed until ambiguity drops below the resolved threshold.

## Purpose

AI can build anything. The hard part is knowing what to build. Deep Interview applies Socratic methodology to iteratively expose assumptions and mathematically gate readiness, ensuring genuine clarity before spending execution cycles.

Inspired by the [Ouroboros project](https://github.com/Q00/ouroboros), which demonstrated that specification quality is the primary bottleneck in AI-assisted development.

## Execution policy

- Ask **ONE question at a time** — never batch multiple questions.
- Target the **WEAKEST clarity dimension** with each question; name it, state its score/gap, and explain why the next question aims there.
- Gather codebase facts via a subagent **before** asking the user about them; for brownfield confirmation questions, cite the repo evidence (file path, symbol, pattern) that triggered the question.
- Score ambiguity after every answer using the `deep_interview_score` tool; display the score transparently.
- Lock a **Round 0 topology** (top-level components) before any ambiguity scoring; rotate targeting across active components when more than one is present so depth-first clarity on one cannot hide ambiguity in siblings.
- Do not proceed to execution until ambiguity ≤ threshold AND the user explicitly approves a scoped execution path.
- Allow early exit (round 3+) with a clear warning if ambiguity is still high.
- Challenge modes activate at specific round thresholds to shift perspective (see below).

## Phase 0: resolve the ambiguity threshold

The `deep_interview_score` tool carries the deployment threshold (default `0.2`, i.e. 20%). Read it from the tool's own result/description rather than hardcoding; the first user-visible line of the interview MUST state the threshold:

```
Deep Interview threshold: {thresholdPercent} (source: deep_interview_score tool config)
```

## Phase 1: initialize

1. Parse the user's idea from the request.
2. Detect **brownfield vs greenfield**: if the workspace has existing source code AND the idea references modifying/extending something, it is brownfield; otherwise greenfield.
3. For brownfield, build first-round context by exploring the relevant codebase areas (via a subagent) and, if prior `deep-interview` specs or `ralplan` plans exist in the workspace, summarize the 1–3 most relevant durable facts — do not re-ask facts already crystallized.
4. Announce the interview:

```
Deep Interview threshold: {thresholdPercent} (source: deep_interview_score tool config)

Starting deep interview. I'll ask targeted questions to understand your idea thoroughly before building anything. After each answer, I'll show your clarity score. We'll proceed once ambiguity drops below {thresholdPercent}.

Your idea: "{idea}"
Project type: {greenfield|brownfield}
Current ambiguity: 100% (we haven't started yet)
```

## Round 0: topology enumeration gate

Run once, before any ambiguity scoring, to lock the **shape** of the scope:

1. Enumerate candidate top-level components (independent outcomes/workstreams/surfaces/integrations). Prefer 1–6; group siblings if more. Do NOT treat implementation tasks or sub-features as top-level components unless the user framed them as independent outcomes.
2. Ask ONE confirmation question:

```
Round 0 | Topology confirmation | Ambiguity: not scored yet

I'm reading this as {N} top-level component(s):
1. {name}: {one-sentence description}
2. ...

Is that topology right? Should any component be added, removed, merged, split, or explicitly deferred?
```

3. Lock the topology after the answer. Each component carries an id, name, description, status (`active|deferred`), evidence, and per-dimension clarity scores (initially null).

Multi-component interviews must keep every active component's clarity tracked and rotate targeting; the Round 0 gate prevents depth-first questioning from overfitting to the single most-described component.

## Phase 2: interview loop

Repeat until ambiguity ≤ threshold, or the user exits early.

### Step 2a: generate the next question

- Build context from: the (prompt-safe) initial idea, prior Q&A rounds, current per-dimension scores, locked topology, and brownfield codebase context (cited paths/symbols, not raw dumps).
- Identify the active component + dimension with the LOWEST clarity; rotate across active components when tied; state why this pair is now the bottleneck.
- Questions expose **ASSUMPTIONS**, not feature lists.
- If the core noun keeps shifting (scope-fuzzy), switch to an ontology-style question that asks what the thing fundamentally IS.

Question styles by dimension:

| Dimension | Style | Example |
|---|---|---|
| Goal | "What exactly happens when…?" | "When you say 'manage tasks', what specific action does a user take first?" |
| Constraint | "What are the boundaries?" | "Should this work offline, or is connectivity assumed?" |
| Success criteria | "How do we know it works?" | "If I showed you the finished product, what would make you say 'yes, that's it'?" |
| Context (brownfield) | "How does this fit?" | "I found JWT auth in `src/auth/` — should this extend that path or intentionally diverge?" |
| Scope-fuzzy / ontology | "What IS the core thing here?" | "You've named Tasks, Projects, and Workspaces — which is the core entity, and which are supporting views?" |

### Step 2b: ask the question

Use `ask_user_question` (one question, contextual options plus free-text):

```
Round {n} | Component: {target} | Targeting: {weakest_dimension} | Why now: {rationale} | Ambiguity: {score}%

{question}
```

### Step 2c: score ambiguity (mathematical gate)

After the answer, judge each active dimension's clarity in [0, 1] from the transcript, extract the current round's key entities (nouns) with name/type/fields, then call the **`deep_interview_score` tool** with:

- `type`: `greenfield` | `brownfield`
- `scores`: `{ goal, constraints, criteria, context? }` (your per-dimension judgement)
- `entities`: the current round's entities
- `previousEntities`: the prior round's entities (round 2+ only)

The tool returns the exact weighted ambiguity, the weighted breakdown, the weakest dimension, and the ontology-stability ratio (stable/changed/new/removed, where a renamed entity with the same type and >50% field overlap counts toward stability). Do NOT recompute the weighted average yourself — let the tool do the math.

Weights (fixed, applied by the tool):

| Dimension | Greenfield | Brownfield |
|---|---|---|
| Goal | 40% | 35% |
| Constraint | 30% | 25% |
| Success criteria | 30% | 25% |
| Context | — | 15% |

### Step 2d: report progress

```
Round {n} complete.

| Dimension | Score | Weight | Weighted | Gap |
|---|---|---|---|---|
| Goal | {s} | {w} | {s*w} | {gap or "Clear"} |
| … | | | | |

Ambiguity: {score}%
Topology: targeted {component} | active {N} | deferred {M}
Ontology: {entity_count} entities | stability {ratio} | new {n} | changed {c} | stable {s}
Next target: {component} / {weakest_dimension} — {rationale}

{score <= threshold ? "Clarity threshold met!" : "Focusing next question on: {weakest_dimension}"}
```

### Step 2e: soft limits

- **Round 3+**: allow early exit if the user says "enough", "let's go", "build it".
- **Round 10**: soft warning — "We're at 10 rounds. Current ambiguity: {score}%. Continue or proceed with current clarity?"
- **Round 20**: hard cap — "Maximum interview rounds reached. Proceeding with current clarity ({score}%)."

## Phase 3: challenge modes

Shift questioning perspective at thresholds; each mode is used once, then normal Socratic questioning resumes.

| Mode | Activates | Purpose | Prompt injection |
|---|---|---|---|
| Contrarian | Round 4+ | Challenge assumptions | "What if the opposite were true? Is this constraint real or habitual?" |
| Simplifier | Round 6+ | Remove complexity | "What's the simplest version that would still be valuable? Which constraints are assumed vs necessary?" |
| Ontologist | Round 8+ (if ambiguity > 0.3) | Find essence | "Looking at these entities, which is the CORE concept and which are supporting?" |

## Phase 4: crystallize the spec

When ambiguity ≤ threshold (or hard cap / early exit):

1. Generate a spec from the transcript (summarize oversized context; never overflow).
2. Write it to a file in the workspace (e.g. `deep-interview-{slug}.md`), with this structure:

```markdown
# Deep Interview Spec: {title}

## Metadata
- Rounds: {count} · Final ambiguity: {score}% · Type: {greenfield|brownfield}
- Threshold: {threshold} (source: {thresholdSource})

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|---|---|---|---|
| … | | | |

## Topology
| Component | Status | Description | Coverage / Deferral note |
|---|---|---|---|

## Goal
{crystal-clear goal covering every active component}

## Constraints
- …

## Non-Goals
- …

## Acceptance Criteria
- [ ] {testable criterion}

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|---|---|---|

## Technical Context
{brownfield codebase findings or greenfield technology choices}

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|---|---|---|---|

## Ontology Convergence
{stability across rounds}

## Interview Transcript
<details><summary>Full Q&A ({n} rounds)</summary>…</details>
```

## Phase 5: execution bridge (approval-gated)

After the spec is written, mark it `pending approval` and present execution options via `ask_user_question`. Until the user selects an option, do NOT mutate files, run mutation-oriented commands, commit, or delegate implementation:

1. **Refine with ralplan consensus (recommended)** — invoke the `ralplan` tool with the spec as the objective (the interview already gathered requirements; the Planner/Architect/Critic loop refines feasibility), then stop with the plan `pending approval`.
2. **Execute with team** — invoke the `team` tool with the spec as the objective.
3. **Execute with ralph** — invoke the `ralph` tool (built into DSH) with the spec as the objective.
4. **Refine further** — return to the interview loop.

On explicit selection, hand off to the chosen tool via its tool call; do NOT implement directly — deep-interview is a requirements agent, not an execution agent.

Recommended pipeline:

```
deep-interview (clarity gate)
  → ralplan consensus (feasibility gate)
  → separate approval
  → team / ralph execution
```

Each stage is a different quality gate: clarity, feasibility, consent. Skipping a stage is possible but reduces assurance.

## Escalation and stop conditions

- **Hard cap at 20 rounds** — proceed with whatever clarity exists, noting the risk.
- **Soft warning at 10 rounds** — offer to continue or proceed.
- **Early exit (round 3+)** — allow with warning if ambiguity > threshold.
- **User says "stop"/"cancel"/"abort"** — stop immediately; the session persists for resume.
- **Ambiguity stalls** (±0.05 for 3 rounds) — activate Ontologist mode to reframe.
- **All dimensions ≥ 0.9** — skip to spec generation even before the round minimum.
- **Codebase exploration fails** — proceed as greenfield, note the limitation.

## Ambiguity interpretation

| Range | Meaning | Action |
|---|---|---|
| 0.0 – 0.1 | Crystal clear | Proceed immediately |
| ≤ threshold | Clear enough | Proceed |
| Above threshold, minor gaps | Some gaps | Continue interviewing |
| Moderate | Significant gaps | Focus on weakest dimensions |
| High | Very unclear | Consider Ontologist reframing |
| Extreme | Almost nothing known | Keep going |

## Failure modes to avoid

- **Batching questions** — ask one at a time; batching yields shallow answers and inaccurate scoring.
- **Asking about codebase facts** — explore first; never ask the user what the code already reveals.
- **Proceeding despite high ambiguity** — the mathematical gate exists to prevent exactly this.
- **Recomputing the weighted average yourself** — call `deep_interview_score`; the weights and formulas are fixed code.
- **Skipping the Round 0 topology gate** — depth-first questioning overfits to the most-described component without it.
