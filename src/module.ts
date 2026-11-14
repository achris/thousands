import { MODULE_ID, initMessage } from "./constants.js";

declare const Hooks: {
  once(hook: string, callback: () => void): number;
};

Hooks.once("init", () => {
  console.log(initMessage(MODULE_ID));
});
