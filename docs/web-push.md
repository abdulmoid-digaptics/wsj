# Workspace Junction PWA and notifications

## Configure and roll out

1. Install the pinned dependencies in the root and `backend/`. Generate the Prisma client with `npm --prefix backend run prisma:generate`.
2. With `DATABASE_URL` targeting the intended database, run `npm --prefix backend run db:migrate`. Apply the migration before starting the updated API workers.
3. Generate one VAPID key pair per environment with `npx --no-install web-push generate-vapid-keys` from `backend/`. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a `mailto:` contact or HTTPS URL) on the backend only. Keep the private key out of source control. Without VAPID, the in-app inbox still works. If you rotate these keys, users may need to turn push off and reconnect their devices.
4. Serve Next.js and the `/api/notifications/*` rewrite under the same HTTPS origin. Do not cache `/sw.js` or authenticated API responses at the proxy. The worker caches only the static public offline page and allowlisted app icons. Account, admin, API and payment traffic is network-only. On navigation failure, the same generic offline page can be shown. Door codes and booking records are never persisted for offline use.

Push preferences apply to the current browser install; the in-app inbox always retains its records. A browser subscription belongs to one signed-in customer or staff identity. For separate identities, use separate browser profiles, or turn off push from the original account before enrolling another account on the same profile. On iOS/iPadOS 16.4+, install via Add to Home Screen and launch the installed app to opt in. Some browsers don’t fire `pushsubscriptionchange`; if push stops working, revisit Notification Settings to reconnect. Source-only/static previews without same-origin API rewrites can show the app shell but cannot enroll devices.

## Staging acceptance checklist

- Check the bottom tabs on phones and portrait tablets; check the 260 px sidebar on wide touch devices in landscape. Check desktop with a fine pointer to confirm its original navigation remains. At each size, check document width, safe-area padding, and navigation, then open a mobile dialog and swipe down from its handle. Use physical iOS Safari and Android Chrome for safe-area and OS-level verification.
- Sign in as a test customer on staging. Confirm opening the app does not invoke any browser permission dialog. Open Notification Settings and use Turn on notifications, then confirm an active `PushSubscription` for that customer in the staging DB. Changing a topic must persist after reopening the tray. Test both turning push off and allowing it again.
- Confirm a sandbox booking and a Stripe test-mode checkout. Verify one customer notification per confirmed booking, an upcoming-access reminder within one hour, and no change to checkout status. Verify a new test lead alerts admins/editors and a failed test payment alerts admins. Check that a signed-in user cannot see or mark another user's notification.
- Verify one delivered OS notification on desktop, tablet, and mobile. Click a notification with the site closed; check that it opens the correct portal route. Then repeat while checkout is open: checkout should not be replaced by a notification click to another portal.
