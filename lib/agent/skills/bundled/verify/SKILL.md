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
3. **Look again.** Did what should happen happen: the message, the new row, the total, the next screen? `reload` to check it was saved. `eval` reads what has no text: a canvas, a variable, a game's state.

Run the shortest path that makes the change run: the form changed, send it; the cart changed, add a product and go to checkout; the sign-in changed, sign in. Then one odd case: an empty or wrong value, coming back after a reload.

`view_page mode="measure"` reports the JavaScript errors, what overflows on a phone and the contrast: an error in the console counts as a failure even when the screen looks right.

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
