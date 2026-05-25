# Description

Two templates for OpenLen — an open-source landing-page builder (https://openlen.com). Lets OpenLen users one-click point their own domain at their published landing page from Cloudflare and other Domain Connect-enabled DNS providers.

## Type of change

- [x] New template

# How Has This Been Tested?

- [x] Template functionality checked using [Online Editor](https://domainconnect.paulonet.eu/dc/free/templateedit) — links in the section below
- [x] Template file name follows the pattern `<providerId>.<serviceId>.json`
- [x] resource URL provided with `logoUrl` is actually served by a webserver (https://openlen.com/icon.svg)

# Checklist of common problems

- [x] `syncPubKeyDomain` is set (`dc.openlen.com`; v1 key live at `v1.dc.openlen.com`)
- [x] `warnPhishing` is not set alongside `syncPubKeyDomain`
- [x] `syncRedirectDomain` not needed — `redirect_uri` is only used to bounce the user back to openlen.com (and openlen.com is the providerId, so it is implicitly the redirect domain)
- [x] no TXT record contains SPF content
- [x] `txtConflictMatchingMode` — not applicable; `_openlen-challenge` is a service-specific name with no uniqueness requirement (multiple unrelated TXTs at the same host don't conflict)
- [x] no variable as a bare full record value — `%token%` is in a fixed `_openlen-challenge` namespace
- [x] no bare variable as host label — host fields use `@` and `_openlen-challenge` (fixed)
- [x] no variable used in host field — uses built-in `host` parameter via `hostRequired: true` on the subdomain template
- [x] `%host%` does not appear in any host attribute
- [x] `essential` not needed — both records are mandatory; user removing either breaks the integration

## Notes on linter warnings

- `DCTL1021` on `_openlen-challenge` — not registered with IANA. Following the de-facto pattern used by Vercel (`_vercel`), Resend (`resend`), Netlify (`_netlify-challenge`), etc. The prefix is namespaced to OpenLen so collisions are unlikely.

## Online Editor test results

apex template (covers both empty host and host-set cases since `hostRequired` defaults to false):

- [Test openlen.com/custom-domain-apex example.com/@](https://domainconnect.paulonet.eu/dc/free/templateedit?token=H4sIADzJFGoC%2F%2B1Ta2vbMBT9K0JQ2Fjs2E6clMCgj3zp2j0KKdkowSjSrSNqS54kJ%2FFC%2Fvuu8mgS9vraDwMby%2FeeI517ru6KOiirgjmggxWtjJ5LAeZG0AHVFagCVMh1SVsvqU%2BsRCj9jMk7UJiwYOaSw4bCa%2Bt0GQhdMqkCVsHyADglkusNlFwihgw3eA9tFP9ST2%2Bh2YUGVPDwVMgcjJUaU3GLFjrXD6ZA2My5yg7a7SNsW3KtQjvPkSTAciMrtyHSa60UcEcaXRtitHZkq5i8gTAPN2ErHfhN3hKnt7i98IIpIVVOKpZD6PUwI9m0gOHJEU4%2FI1Za4mZAKjABL5gsCYqXT5IzjyJzVtRAclBg0H9BFjOkeHyNlhEmxJa904bPToI%2F1QDXRlg6eFxR11Te2UsMz7R1uLzwDdNSOTvS%2BBv3z8M47YVxP8U3xqRzaFonitatF%2Fro6%2BiwQbbzMeAzVuA3B28icwxzZ5vazo53maxb9IdWkB1kTRC%2F7yEsGd4x2DVwdwSucqPrKpN7fMUMK62%2Fh3vm4wl1suc%2BUr%2FeyPA%2FDqyLkw71KmSutIHM4pe52mBhztTQomVdOJmxBTuEBM9YVRUNiraYxZ1OvVTbC3txqPzPPrZoJrhXLv0YdEX3KY6mvaAj0jTo8qgfTMVTLziPGesl%2FbTLEzgaqd9M2z%2BH6mAiWAvKSean4LJYsMbS9S9t3dXyt7buXXy9RU1aeEv%2B9%2Bh19wgH07I5iIx5WBIlvSBKgyQdJckg9k%2BIobTTfRdFgyjylWBN2%2FJWOL%2FHk0uTLjyP28Nmcf79%2Fls5YmPzYTi8ehiPr6S6X97U4pbnd3wYfUxv3tP1Txri9pTLBgAA)

- [Test openlen.com/custom-domain-apex example.com/landing](https://domainconnect.paulonet.eu/dc/free/templateedit?token=H4sIAC%2FJFGoC%2F%2B1T72vbMBD9V4SgsNHYsd06WQ2D9cc%2BbB3rPmRQVoJRpJuj1ZY8SY6bhfzvOzlOk5CNfd1gkMTO3bvTe%2B90K%2BqgqkvmgGYrWhu9kALMO0EzqmtQJaiQ64oOnlMfWYVQeofJD6AwYcEsJIeuhDfW6SoQumJSBayGpx3gsJBcd1ByiRhy0%2BE9dKn4p2Z2C8s%2BlFHBw0MiCzBWakzFA1rqQn82JcLmztU2Gw73sEPJtQrtosAiAZYbWbuukF5rpYA7stSNIUZrRzaMyQsIi7ALW%2BnAN3lJnN7gtsRLpoRUBalZAaHnw4xksxJuDo5w%2BhGx0hI3B1KDCXjJZEWQvPwqOfMosmBlA6QABQb9F6SdY4nHN2gZYUJsqntu%2BOkp%2BFMNcG2EpdnDirpl7Z29xPBcW4evb%2FzAtFTOTjT%2BjcevwjgdhfE4xW%2BMSefQtLMoWg%2Beyyf3k12DvPcx4HNW4rMAbyJzDHMnnbaT%2FS7T9YD%2B0AryHa0p4rczhCeGdwz6AfZH9D5ioDC6qXO5LauZYZX113Hb4OGgw3Tb4uG5B4Y6Uj7mwLo4OaOekyyUNpBbfDLXGJTpTAMDWjWlkzlr2S4keM7qulyiBItZ7HTorNpc3x3r3o3fezugueBehvSrMU7PY5Gws4DPZjw45ywOZmIs8IeP%2BFiIiKWjvTX7xQb%2BcdGOjAVrQTnJ%2FIJcli1bWro%2Bmngv7Hji4ZHWrbV%2FvcbpAC%2FS%2F%2Fn9u%2FPDhbZsASJnHp1EySiI0iBJJ0mSxXGWXoQXyUWaJqdRlEWRF4TSNipXuPf7G0%2B%2FfT81dzaCL0XDbltdjybnN3H71rZX4v399VC3j7eVm9eT06v2NV3%2FBKNfd5URBwAA)

subdomain template (hostRequired=true, only the host-set case is meaningful):

- [Test openlen.com/custom-domain-subdomain example.com/landing](https://domainconnect.paulonet.eu/dc/free/templateedit?token=H4sIALvIFGoC%2F%2B1UbWvbMBD%2BK0JQ2FjsOE6aNoHBStKNsbXbkuyFlmAU%2BeJosyVHktO5If99p8R5W8bY142Bwfbdc3fPPafTklrI8pRZoN0lzbVaiBj065h2qcpBpiB9rjJa27luWYZQ%2Bg6db0Giw4BeCA7rEF4YqzIvVhkT0jPFZPO1Rx1Hk94aT4aHwFLy98XkDZT9jalLY%2B4fc1mANkKhq1GjqUrUR50ibGZtbrr1%2BgG2LriSvlkkGBSD4Vrkdh1Ie0pK4JYwsmNJnoCf%2BCRlMhYy8UtVYBULLs9TYhVxBrJlXqFIzhLwHSWmBZuk0D%2BqYtU3xApD7AxIDtrjKRMZQf5iKjhzKLJgaQEkAQkapxCThxmGOHyBmhEWx5voiiM%2BFQVXdaaMHcC8EBpQfqsLqFENXOnY0O79ktoyd3L3bq9uris4%2Fr5w41RCWjNSu6H9JLG1KGkzCFa1XZbRl9E%2BR1TBPT5jKb4TcBIzy9B3tm777DDLeFWjj0pCtGc3Rvx2wvCd4SGEqnZVopIYDYlWRR6JbVjONMuMO6%2FbBPdHGcbbFPe7HGhak3I2C8Y2wiZ1nEQilYbI4JvZQsNWxKxIrYjYA9ubYh6xPE9LbMGgFzOdCiw3x3vPvFLktxLXaBRz141wK9S%2B7FxMeRB64eW04bV4I%2FQmk7DpQZM1OxwuWmzCDtbxF5v6Zwt5IjIYA9IK5lbpKn1gpaGrk%2BlXDZ5O3z%2FpeSvz39HouIYn6%2F9A%2F6GB4sobtoA4Yg4dBmHbC8698HwUht1G0A2aftBqh%2B32swB%2FAtcV9rdpdYk3w%2BGdQJMPrcE8udCv5p3%2BAAZfH%2FvN%2BrW5u5uOPnduhr2Xnwo7LIdtm6ub53T1AxxOJbtUBwAA)

## Live verification

- `syncPubKeyDomain` TXT record: `dig +short TXT v1.dc.openlen.com`
- Origin target: `custom.openlen.com` (CNAME) → `178.156.175.171` (apex A)
- Logo: https://openlen.com/icon.svg
- Site: https://openlen.com
