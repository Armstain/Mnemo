import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { renderCaptureWidget } from './CaptureWidget';
import { readWidgetSnapshot } from './snapshot';

/** Android asks for the widget when it's added, resized or due a refresh. */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetInfo.widgetName !== 'Capture') return;
  if (props.widgetAction === 'WIDGET_DELETED' || props.widgetAction === 'WIDGET_CLICK') return;
  props.renderWidget(renderCaptureWidget(await readWidgetSnapshot()));
}
