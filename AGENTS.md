<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture decisions

- The frontend only receives final webhook events (SLOT_LOCKED, SLOT_FOUND, SESSION_ACTIVE) from the external Python worker at POST /api/public/bot-event (HMAC-signed). OTP collection, session handling and browser automation live entirely on the external backend — never add OTP relay, login or session endpoints here. (Agreed split with the user, Nov 2026.)

