---
name: verify
description: Check that a change to the page or the app actually works by using it in a real browser, the way a visitor would, and report what was seen. Load it when the user asks whether something works, to test it, or when what you changed does something (a form, a cart, a sign-in, a calculation, a game) and you are about to say it is done.
---

# Checking that it works

Checking is watching the page run. Reading the code, a search, or a test that passes says the code looks right; it does not say the change works. Go through what changed by its interface, the way a visitor would: press the buttons, fill in the fields, never call the backend underneath instead. What you see is the evidence.

## How

Use `use_page` on the canvas. Its tab stays open for the whole turn, each call carries on where the last one left the page, and it loads your latest files first. In an app, `screen` opens a screen by its hash route (`"#/sales"`). To visit signed in, `sign_in_as` with a user's email in the test database.

Look before you act, and look again after:
1. **Look.** A `screenshot` step (`"screen"`, or a text of the block you care about) or a `read` step. If you don't know the button's text or the field's label, read it in the file or on the screen first: steps find things by what a visitor sees, not by CSS.
2. **Act.** `click` with the text on the button, `type` with `into` the field's label, `choose` an option. With several identical buttons, `within` a text of the right block.
3. **Look again.** Did what should happen happen: the message, the new row, the total, the next screen? Take a `screenshot` here, after acting: that frame of the result is the one you present at the end. `reload` to check it was saved. `eval` reads what has no text: a canvas, a variable, a game's state.

Run the shortest path that makes the change run: the form changed, send it; the cart changed, add a product and go to checkout; the sign-in changed, sign in. Then one odd case: an empty or wrong value, coming back after a reload.

`view_page mode="measure"` reports the JavaScript errors, what overflows on a phone and the contrast: an error in the console counts as a failure even when the screen looks right.

## When it moves

A game, an animation, a carousel, a drag, a notice that appears and goes: one screenshot is one moment, and motion needs several.

- **Without a real terminal**, with `use_page` steps: `key` presses a key (`"ArrowRight"`, `"Enter"`, `"ctrl+k"`; `repeat` for several presses), `left_click` and `hover` act at an `[x, y]` of the tab (what has no text: a canvas, a map), `left_click_drag` drags from one point to another (`coordinate` is where it ends), and `wait` lets time pass. Put a `screenshot` between them to see the moments (three per visit) and `zoom` for a region in detail. `use_page` reads the page's text, and a canvas or a video has none: with one in view it says so instead of "nothing changed", and what it shows is yours to look at.
- **With a real terminal** (bash runs commands and Playwright is installed in it): write a short Playwright script that moves time itself with `page.clock`, holds keys with `keyboard.down` and `keyboard.up`, drags with the mouse and saves screenshots in `/tmp/motion/`; then join them into one image with `python3 <base directory>/scripts/contact_sheet.py` and look at it with `Read`. How, in references/playwright.md ("Looking at motion").
- **To look closer** at any image, `Read` it again with `region`: that rectangle comes back at full detail.
- **Does the input do anything?** Make the same short series twice from the same start, once with the key and once without. The same frames mean the key does nothing, even when the screen moves.
- A key that has to be **held** to move something (a game's arrows) is checked only with the script: `key` presses and releases. Without a real terminal, the held movement is what you couldn't verify, and you say so.

Keep it short: a few series of a second or two that show the behavior, never playing the game to the end. If two or three tries don't make it clear, answer **couldn't verify** and say what you saw.

## What is never done for real

- To check something, never publish: the canvas is enough.
- `use_page` sends what the page saves to the test database, never to the published site's data, and a form does not reach the user's email.
- Payments only in test mode: Stripe with the draft's test key and its test cards (4242 4242 4242 4242 pays). Checkout opens outside the canvas; `use_page` tells you where the link was going, and `stripe trigger <event>` sends the webhook a test event.
- Emails from the draft reach only the project's team: test with their addresses.
- Nothing that writes to production data. `db query --linked` only reads it.

When there is no safe way to run something, check it as far as you can and say exactly what you did not check.

## A test that runs again

Only when the user wants one: a check you run now is not a test they asked to keep. A page's tests go in `/tests` and run with `npx playwright test`; an app's run with `npm test`. How to write them is in references/playwright.md.

## The answer

Start with one verdict:
- **works**: what you did and what you saw.
- **fails**: the step where it broke, what happened instead, and the error if there was one.
- **couldn't verify**: where it got stuck and why, and what the user can try.

The evidence has to reach the user, and they don't see the screenshots view_page and use_page show you. Each one is kept for this turn at the path in the tool's `screenshots`: present the one that shows the result (or the failure) and say in one line what it shows. Write what the page said word for word where it matters: the confirmation message, the total, the error.

Then, briefly, anything you noticed on the way that is not a failure but looked wrong: a slow step, a label cut off, a warning in the console.
