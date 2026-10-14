import type { ToolHandler } from '../controller';
import { find, read, screenshot, snapshot } from './observe';
import { tabs } from './tabs';
import { navigate } from './navigate';
import { click, hover, scroll } from './act';
import { press, set, type } from './text';
import { wait } from './wait';
import { handleDialog } from './dialog';
import { askUser } from './ask';
import { fillForm } from './fill';
import { upload } from './upload';

/** Tool name to handler. Arguments arrive validated against the catalogue's schema. */
export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  snapshot: (ctx, args) => snapshot(ctx, args as never),
  find: (ctx, args) => find(ctx, args as never),
  read: (ctx, args) => read(ctx, args as never),
  screenshot: (ctx, args) => screenshot(ctx, args as never),
  tabs: (ctx, args) => tabs(ctx, args as never),
  navigate: (ctx, args) => navigate(ctx, args as never),
  click: (ctx, args) => click(ctx, args as never),
  hover: (ctx, args) => hover(ctx, args as never),
  scroll: (ctx, args) => scroll(ctx, args as never),
  set: (ctx, args) => set(ctx, args as never),
  type: (ctx, args) => type(ctx, args as never),
  press: (ctx, args) => press(ctx, args as never),
  wait: (ctx, args) => wait(ctx, args as never),
  handle_dialog: (ctx, args) => handleDialog(ctx, args as never),
  ask_user: (ctx, args) => askUser(ctx, args as never),
  fill_form: (ctx, args) => fillForm(ctx, args as never),
  upload: (ctx, args) => upload(ctx, args as never),
};
