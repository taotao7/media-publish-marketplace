export const CREATOR_UPLOAD_URL =
  "https://member.bilibili.com/platform/upload/video/frame"

export const LOGIN_QRCODE_SELECTORS = [
  "img[alt*='二维码']",
  "img[src*='qrcode']",
  "img[class*='qrcode']",
  "[class*='qrcode'] img",
  "[class*='qr'] img",
] as const

export const LOGIN_TEXTS = [
  "扫码登录",
  "请使用哔哩哔哩客户端扫码登录",
  "二维码已失效",
  "密码登录",
  "短信登录",
  "忘记密码",
  "没有账号立即注册",
] as const

export const CREATOR_READY_TEXTS = [
  "创作中心",
  "投稿",
  "上传视频",
  "稿件投递",
  "稿件标题",
  "稿件简介",
  "立即投稿",
  "提交稿件",
] as const

export const FILE_INPUT_SELECTORS = [
  "input[type='file'][accept*='video']",
  "input[type='file'][accept*='mp4']",
  "input[type='file']",
] as const

export const TITLE_INPUT_SELECTORS = [
  "input[placeholder*='标题']",
  "input[placeholder*='稿件标题']",
  "input[maxlength='80']",
  "input[maxLength='80']",
  "input[maxlength='100']",
  "input[maxLength='100']",
] as const

export const DESCRIPTION_INPUT_SELECTORS = [
  "textarea[placeholder*='简介']",
  "textarea[placeholder*='描述']",
  "[contenteditable='true'][data-placeholder*='简介']",
  "[contenteditable='true'][placeholder*='简介']",
  "[contenteditable='true'][class*='editor']",
] as const

export const TAG_INPUT_SELECTORS = [
  "input[placeholder*='标签']",
  "input[placeholder*='按回车']",
  "input[placeholder*='Enter']",
  "input[placeholder*='话题']",
] as const

export const CATEGORY_TRIGGER_SELECTORS = [
  "[class*='category'] [class*='select']",
  "[class*='archive-type'] [class*='select']",
  "[class*='partition'] [class*='select']",
  "[class*='category'] input",
  "[class*='partition'] input",
] as const

export const SOURCE_INPUT_SELECTORS = [
  "input[placeholder*='来源']",
  "input[placeholder*='原视频']",
  "input[placeholder*='转载']",
] as const

export const PUBLISH_BUTTON_SELECTORS = [
  "button[class*='submit']",
  "button[class*='publish']",
  "button[class*='primary']",
  "[role='button'][class*='submit']",
] as const

export const PUBLISH_BUTTON_TEXTS = [
  "立即投稿",
  "提交稿件",
  "立即发布",
  "确认投稿",
] as const

export const PUBLISH_PENDING_TEXTS = [
  "上传中",
  "处理中",
  "转码中",
  "请稍候",
  "请等待",
  "上传还未完成",
  "正在上传",
  "正在处理",
] as const

export const PUBLISH_SUCCESS_TEXTS = [
  "投稿成功",
  "稿件投递成功",
  "提交成功",
  "上传成功",
  "投稿完成",
] as const

export const PUBLISH_ERROR_TEXTS = [
  "标题不能为空",
  "请选择分区",
  "转载来源不能为空",
  "标签数量过多",
  "标签不能为空",
  "上传失败",
  "投稿失败",
] as const
