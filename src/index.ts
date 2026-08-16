/**
 * Oh-My-DeepSeek — multi-agent orchestration plugins for DeepSeek Harness.
 *
 * This is a bundle package: the Loader mounts the two plugin subpath modules
 * declared in cordis.patch.yml (`oh-my-deepseek/ralplan`, `oh-my-deepseek/team`).
 * The re-exports below exist for programmatic consumption; the Loader does not
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
