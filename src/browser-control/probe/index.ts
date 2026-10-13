// The probe as a string constant, evaluated once per isolated world.
import { probeMain } from './source';

export type {
  FileInfo,
  FileInputFacts,
  FormFacts,
  GuardReport,
  GuardStep,
  HitVerdict,
  NavigationTarget,
  OptionResult,
  PageFacts,
  ProbeApi,
  ProbeState,
  ScrollInfo,
  SelectedOption,
} from './source';

export const PROBE_WORLD_NAME = 'nanobrowser-probe';

/** Evaluated in the isolated world; defines globalThis.__nbProbe there. */
export const PROBE_SOURCE = `(${probeMain.toString()})();`;
