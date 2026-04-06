export const CREATOR_UPLOAD_URL =
  "https://creator.douyin.com/creator-micro/content/upload"

export const LOGIN_TEXTS = ["扫码登录", "验证码登录", "密码登录", "登录/注册"] as const
export const PUBLISH_READY_TEXTS = [
  "发布作品",
  "发布视频",
  "上传视频",
  "作品标题",
  "作品描述",
] as const

export const LOGIN_QRCODE_SELECTORS = [
  "img[class*='qrcode_img']",
  "[class*='qrcode'] img",
] as const

export const LOGIN_PHONE_INPUT_SELECTORS = [
  "input[placeholder='请输入手机号']",
  "input[type='tel'][placeholder*='手机号']",
] as const

export const IMAGE_TAB_SELECTOR = "div.tab-container-DjaX1b > div:nth-child(2)" as const
export const IMAGE_TAB_TEXTS = ["上传图文", "图文"] as const

export const IMAGE_FILE_INPUT_SELECTORS = [
  "input[type='file'][accept*='image']",
  "input[type='file']",
] as const

// Image upload may render either as background-image or as a real <img>.
export const IMAGE_UPLOADED_INDICATOR_SELECTORS = [
  "[style*='creator-media-private.douyin.com']",
  "img[src*='creator-media-private.douyin.com']",
] as const

export const IMAGE_UPLOADED_INDICATOR_SELECTOR =
  IMAGE_UPLOADED_INDICATOR_SELECTORS[0]

export const ADD_MORE_IMAGES_TEXTS = ["继续添加"] as const
export const ADD_MORE_IMAGES_BUTTON_SELECTOR = "button[class*='continue-add']" as const
export const MUSIC_SELECT_TEXTS = ["选择音乐"] as const
export const MUSIC_PICKER_SELECTOR = "[class*='music-side-sheet']" as const

export const SCHEDULE_RADIO_TEXT = "定时发布" as const
export const SCHEDULE_INPUT_SELECTOR = "input[placeholder='日期和时间']" as const

export const FILE_INPUT_SELECTORS = [
  "input[type='file'][accept*='video']",
  "input[type='file']",
] as const

export const TITLE_INPUT_SELECTORS = [
  "input[placeholder*='标题']",
  "input[placeholder*='填写标题']",
  "input[placeholder*='作品标题']",
] as const

export const DESCRIPTION_INPUT_SELECTORS = [
  "textarea[placeholder*='简介']",
  "textarea[placeholder*='描述']",
  "textarea[placeholder*='作品描述']",
  "[contenteditable='true'][data-placeholder*='描述']",
  "[contenteditable='true'][data-placeholder*='简介']",
  "[data-slate-editor='true'][contenteditable='true']",
] as const

export const TAG_INPUT_SELECTORS = [
  "input[placeholder*='标签']",
  "input[placeholder*='添加标签']",
  "input[placeholder*='话题']",
  "input[placeholder*='添加话题']",
  "input[placeholder*='输入标签']",
] as const

export const PUBLISH_BUTTON_SELECTORS = [
  "button[class*='primary'][class*='fixed']",
  "button[class*='publish']",
  "button[class*='submit']",
  "[role='button'][class*='publish']",
] as const

export const PROGRESS_SELECTORS = [
  "[class*='progress']",
  "[class*='upload-progress']",
  "[class*='percent']",
] as const
