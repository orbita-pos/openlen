---
name: setup-brand
description: Write down the business's brand as the project's own skill, brand (its colors, type, logo, voice and tone), from what the business already has, so every page, document and email after it looks and sounds like the business. Load it when the user asks to set up, save or define their brand, look or tone, or says their style keeps coming out wrong.
---

# Setting up the brand

The brand belongs to the business, and the project's members share it, so it is saved in the project as the skill `/.len/skills/brand/SKILL.md`, not in anyone's personal memory. Once saved, `brand` is in the skill list.

## 1. Ask before reading

Say in one or two lines what you will read to build it, and wait for the user's yes: it is their material, and building a brand from it needs their consent. The sources:
- the page, published and draft: the colors and fonts actually in use (its CSS variables, its Tailwind config, its buttons and links, the fonts it loads) and its logo;
- the project's memory: `/LEN.md` and the notes in `/.len/memory/`;
- what the owner wrote themselves: texts they pasted or attached, and their own messages.

Only the owner's own words show their voice: take those, and never the texts you wrote for the page, a document or a post, even when they were approved, because they are your words. If the page's texts may be the owner's, ask.

With fewer than five pieces of the owner's own writing, a voice would be a guess: say so, and offer two ways. They paste a few things they wrote (messages to customers, posts, emails they sent), and you build it from those; or you save the brand now with a voice holding only what the owner told you directly about how they speak, and nothing of yours: no default style, no traits you would like them to have. Its line says it was built from none of their texts. Either way, colors, type and logo are saved now.

## 2. Write it

Start from references/brand-skill.md and write `/.len/skills/brand/SKILL.md` with `Write`. Fill every `[[…]]` with what you found, or remove the line when there is nothing for it; never fill one with a guess. Keep its frontmatter exactly as it is: that description is what makes you load it by yourself later.

- **Colors:** in hex, each with its role (background, text, accent), as they are used, not as you would choose them.
- **Type:** each family with its role and where it is loaded from.
- **Logo:** where the file is and when it is used.
- **Voice:** the traits that hold whenever the business speaks, each with a quote of theirs that shows it (cut short, without names or numbers), and the line saying how many of their texts it came from. A trait no text of theirs shows is not written.
- **Tone by audience:** only for the audiences their texts write to (customers, suppliers, social media); leave out the others.
- **Never:** what the business would never say or promise.

## 3. No personal data, no secrets

The skill is read on every turn that loads it and is shared with the project's members. It never holds people's names, phone numbers, email addresses, street addresses, account numbers, passwords or keys: write the pattern, never the value ("the phone goes last, in bold"; "signs with the first name only"). A skill with a credential in it is refused when it is saved.

## When there is no brand yet

A new business, or a page that has no look of its own yet: propose one. Load `frontend-design` and choose, from the business itself (its trade, its place, its customers), a palette, a pair of fonts and a voice. Show it to the user as a short summary with its colors, and save it only when they say yes.

## Afterwards

Tell the user it is saved and what it covers. From then on, load `brand` before a page, a document, an email or a deliverable of this business; where it and `frontend-design` differ, the brand wins. When the user changes something of the brand, change the skill with `Edit` in the same turn.
