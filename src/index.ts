/**
 * Oh-My-DeepSeek — multi-agent orchestration plugins for DeepSeek Harness.
 *
 * This is a bundle package: the Loader mounts the plugin subpath modules
 * declared in cordis.patch.yml (`oh-my-deepseek/ralplan`, `oh-my-deepseek/team`,
 * `oh-my-deepseek/deep-interview`, `oh-my-deepseek/deep-interview-skill`). The
 * re-exports below exist for programmatic consumption; the Loader does not
 * resolve this entry.
 */
export {
  name as ralplanPluginName,
  apply as applyRalplan,
  Config as RalplanConfig,
} from './ralplan.js'
export {
  name as teamPluginName,
  apply as applyTeam,
  Config as TeamConfig,
} from './team.js'
export {
  name as deepInterviewScorePluginName,
  apply as applyDeepInterviewScore,
  Config as DeepInterviewScoreConfig,
} from './deep-interview.js'
export {
  name as deepInterviewSkillPluginName,
  apply as applyDeepInterviewSkill,
} from './deep-interview-skill.js'
export {
  name as exaSearchPluginName,
  apply as applyExaSearch,
  Config as ExaSearchConfig,
  ExaMcpProvider,
  parseMcpResponse,
  EXA_MCP_PROVIDER_ID,
  EXA_MCP_DEFAULT_BASE_URL,
  EXA_MCP_DEFAULT_TOOL,
} from './exa-search.js'
export {
  DIMENSION_WEIGHTS,
  activeDimensions,
  computeAmbiguity,
  computeOntologyStability,
} from './scoring.js'
export type { AmbiguityResult, DimensionScores, Entity, InterviewType, OntologyStability } from './scoring.js'
