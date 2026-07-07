// Category/Subcategory 표기를 Title Case로 통일. 단어별로 첫 글자만 대문자, 나머지는
// 소문자로 바꾼다 (약어도 예외 없이 동일 규칙 적용: "UI" → "Ui").
export function toTitleCase(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}
