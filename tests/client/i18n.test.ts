import { describe, expect, it } from "vitest"
import { en, text, zh } from "../../src/client/i18n.js"

describe("text locale selection", () => {
  it("test_zh_language_tags_use_the_simplified_chinese_dictionary", () => {
    expect(text("zh-CN")).toBe(zh)
    expect(text("zh-TW")).toBe(zh)
  })

  it("test_english_language_tags_use_the_english_dictionary", () => {
    expect(text("en")).toBe(en)
    expect(text("en-GB")).toBe(en)
  })

  it("test_unsupported_and_missing_locale_ids_fall_back_to_english", () => {
    expect(text("es-ES")).toBe(en)
    expect(text("fr-FR")).toBe(en)
    expect(text(undefined)).toBe(en)
  })
})
