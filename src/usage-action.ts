import {
  action,
  type KeyDownEvent,
  SingletonAction,
  type WillAppearEvent
} from "@elgato/streamdeck";

import { CombinedUsageProvider } from "./usage";
import { renderCombinedUsage } from "./usage-render";

@action({ UUID: "com.atsu.claude-code-status.usage-5h" })
export class CombinedUsageAction extends SingletonAction {
  constructor(private readonly provider: CombinedUsageProvider) {
    super();
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const snapshot = await this.provider.getUsage();
    await ev.action.setImage(renderCombinedUsage(snapshot));
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const snapshot = await this.provider.getUsage(true);
    await Promise.all([ev.action.setImage(renderCombinedUsage(snapshot)), ev.action.showOk()]);
  }

  async refresh(force = false): Promise<void> {
    if ([...this.actions].length === 0) return;
    const image = renderCombinedUsage(await this.provider.getUsage(force));
    await Promise.all([...this.actions].map((visibleAction) => visibleAction.setImage(image)));
  }
}
