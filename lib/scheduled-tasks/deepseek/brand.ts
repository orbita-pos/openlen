// The two names DeepSeek's schedule types take from `@deepseek-ai/dsh-brand` and
// `@deepseek-ai/dsh-llm/brand`: a string with a compile-time brand, nothing at runtime.

/** A string the compiler tells apart from other strings. */
export type Branded<K extends string> = string & { readonly __brand: K }

/** A chat message id; only named by types the domain does not use. */
export type MessageId = Branded<'MessageId'>
