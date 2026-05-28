/** Fallback inner size when no UIKit Frame is on the panel (cm). */
export const FALLBACK_FRAME_INNER_WIDTH = 33;
export const FALLBACK_FRAME_INNER_HEIGHT = 18;

export const CONTENT_PAD_X = 2.0;
export const CONTENT_PAD_Y = 1.5;

/** Minimum clear space between the last text row and the footer buttons (cm). */
export const FOOTER_TOP_GAP = 1.2;

export const Z_CONTENT = 2.0;
export const Z_BUTTONS = 1.5;

/** Vertical spacing scale (cm). */
export const SPACE_XS = 0.4;
export const SPACE_SM = 0.6;
export const SPACE_MD = 0.8;
export const SPACE_LG = 1.2;

/** Fixed slot heights for the setup wizard (cm). */
export const SLOT_HEADLINE = 3.0;
export const SLOT_BODY = 3.8;
export const SLOT_INPUT = 2.8;
export const SLOT_STATUS = 2.0;
export const SLOT_FOOTER = 3.5;

/** HUD slot heights (cm). */
export const SLOT_HUD_TITLE = 3.0;
export const SLOT_HUD_STATUS = 2.0;

export const BUTTON_HEIGHT = 3.5;
export const BUTTON_WIDTH = 12;
export const FOOTER_BUTTON_GAP = SPACE_MD;

/** Spectacles UIKit typography — Far distance / Large frame. */
export const FONT_HEADLINE = 72;
export const FONT_BODY = 54;
export const FONT_CAPTION = 42;
export const FONT_BUTTON = 44;
export const FONT_HUD_TITLE = 64;

/** @deprecated Use UIFrameMetrics.contentWidth */
export const PANEL_WIDTH = FALLBACK_FRAME_INNER_WIDTH;
/** @deprecated Use CONTENT_PAD_X */
export const PANEL_PADDING_X = CONTENT_PAD_X;
/** @deprecated Use CONTENT_PAD_Y */
export const PANEL_PADDING_Y = CONTENT_PAD_Y;

export const COLOR_WHITE = new vec4(1, 1, 1, 1);
export const COLOR_MUTED = new vec4(1, 1, 1, 0.55);
export const COLOR_SUCCESS = new vec4(0, 1, 0, 1);
export const COLOR_ERROR = new vec4(1, 0, 0, 1);
export const COLOR_WARN = new vec4(1, 0.85, 0, 1);

export const WS_PORT = 8765;
export const IP_STORAGE_KEY = "dimos_bridge_ip";
