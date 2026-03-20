/** CSS selectors for Xiaohongshu pages — centralised for easy maintenance. */

// Login page
export const LOGGED_IN_INDICATOR =
  ".main-container .user .link-wrapper .channel"
export const QRCODE_IMG = ".login-container .qrcode-img"

// Publish page — layout
export const UPLOAD_CONTENT_AREA = "div.upload-content"
export const CREATOR_TAB = "div.creator-tab"
export const UPLOAD_INPUT_FIRST = ".upload-input"
export const UPLOAD_INPUT = 'input[type="file"]'
export const IMG_PREVIEW = ".img-preview-area .pr"

// Publish page — form
export const TITLE_INPUT = "div.d-input input"
export const TITLE_MAX_SUFFIX = "div.title-container div.max_suffix"
export const CONTENT_EDITOR = "div.ql-editor"
export const CONTENT_PLACEHOLDER = 'p[data-placeholder="输入正文描述"]'
export const CONTENT_LENGTH_ERROR = "div.edit-container div.length-error"

// Tags
export const TOPIC_CONTAINER = "#creator-editor-topic-container"
export const TOPIC_ITEM = ".item"

// Schedule
export const SCHEDULE_SWITCH = ".post-time-wrapper .d-switch"
export const DATE_PICKER_INPUT = ".date-picker-container input"
export const DATE_PICKER_CONTENT =
  ".date-picker-container .d-datepicker-content"

// Actions
export const PUBLISH_BTN = ".publish-page-publish-btn button.bg-red"

// Attachments
export const FILE_RELATION_CONTAINER = ".file-relation-container"
export const FILE_RELATION_INPUT = '.file-relation-container input[type="file"]'

// Overlays
export const POPOVER = "div.d-popover"

// Note manager page
export const NOTE_ITEM = ".d-tabs-pane .note"
export const NOTE_TITLE = ".info .title"
export const NOTE_EDIT_BTN = "span.control.data-edit"
export const NOTE_DELETE_BTN = "span.control.data-del"
export const NOTE_TOP_BTN = "span.control.data-top"

// Delete confirmation dialog
export const DELETE_CONFIRM_BTN = ".d-modal__footer .d-button--theme-primary"
export const DELETE_CANCEL_BTN = ".d-modal__footer .d-button--theme-default"
