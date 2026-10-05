/** 字符串与路径小工具集合。 */

// 注意：slugify 只接受 ASCII，中文请先转写
export function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// TODO: 支持 unicode 归一化
function internal() {
  return 1
}

export const VERSION = '1.0.0'
