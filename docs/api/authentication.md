# Superhuman Authentication Documentation

> Last Updated: 2026-01-31

This document describes how Superhuman handles authentication for both Google and Microsoft accounts.

## Overview

Superhuman uses **standard OAuth 2.0 flows** for authentication:
- **Google accounts**: Google OAuth 2.0 via `accounts.google.com`
- **Microsoft accounts**: Microsoft OAuth 2.0 / MSAL via `login.microsoftonline.com`

Superhuman does NOT have its own authentication system. It relies entirely on the email provider's OAuth tokens.

---

## OAuth Providers

### Google OAuth 2.0

**Authorization Endpoint:** `https://accounts.google.com/o/oauth2/v2/auth`

**Required Scopes (discovered from localStorage):**
```
https://mail.google.com/
https://www.googleapis.com/auth/gmail.settings.basic
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/contacts
https://www.googleapis.com/auth/contacts.other.readonly
https://www.googleapis.com/auth/directory.readonly
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
openid
```

**APIs Used:**
- Gmail API (`gmail.googleapis.com`)
- Google Calendar API (`calendar.googleapis.com`)
- People API (`people.googleapis.com`)

### Microsoft OAuth 2.0 / MSAL

**Authorization Endpoint:** `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`

**Required Scopes (discovered from localStorage):**
```
email
openid
profile
https://graph.microsoft.com/Calendars.ReadWrite
https://graph.microsoft.com/Calendars.ReadWrite.Shared
https://graph.microsoft.com/Contacts.Read
https://graph.microsoft.com/Contacts.ReadWrite
https://graph.microsoft.com/Files.ReadWrite
https://graph.microsoft.com/Mail.ReadWrite
https://graph.microsoft.com/Mail.Send
https://graph.microsoft.com/MailboxSettings.ReadWrite
https://graph.microsoft.com/OnlineMeetings.ReadWrite
https://graph.microsoft.com/People.Read
https://graph.microsoft.com/User.Read
https://graph.microsoft.com/User.ReadBasic.All
```

**APIs Used:**
- Microsoft Graph API (`graph.microsoft.com`)

---

## Token Storage

### localStorage Keys

Superhuman stores account metadata in localStorage with the pattern `{email}:{key}`:

| Key Pattern | Description |
|-------------|-------------|
| `{email}:provider` | OAuth provider ("google" or "microsoft") |
| `{email}:scopes` | Granted OAuth scopes |
| `{email}:id` | Provider-specific user ID |
| `{email}:seatId` | Superhuman seat identifier |
| `{email}:name` | User display name |
| `{email}:accountColor` | UI theme color |
| `logins` | JSON array of all linked accounts |
| `defaultAccount` | Email of default/current account |
| `googleStateParam` | OAuth state parameter for CSRF protection |
| `deviceId` | Unique device identifier |

**Example `logins` structure:**
```json
[
  {
    "emailAddress": "user@gmail.com",
    "isLoggedIn": true,
    "isDemoAccount": false,
    "isPublicAccount": false,
    "provider": "google",
    "pseudoTeamId": "team_xxxxx"
  },
  {
    "emailAddress": "user@company.com",
    "isLoggedIn": true,
    "isDemoAccount": false,
    "isPublicAccount": false,
    "provider": "microsoft",
    "pseudoTeamId": "team_yyyyy"
  }
]
```

### Actual OAuth Tokens

OAuth access tokens and refresh tokens are stored in a **secure context** that is not directly accessible via JavaScript. The tokens are likely stored in:

1. **HttpOnly Cookies** - Set by Superhuman's backend with `HttpOnly` and `Secure` flags
2. **IndexedDB** - Encrypted token storage (databases: `localforage`, `serviceworker-logs`)
3. **Credential Manager** - Browser-provided secure storage

The `window.GoogleAccount.credential` object provides methods to retrieve tokens but the actual token values are blocked from direct inspection.

---

## Authentication Flow

### Initial Login Flow

1. User navigates to `mail.superhuman.com`
2. Superhuman redirects to `/login` or `/signin`
3. User clicks "Sign in with Google" or "Sign in with Microsoft"
4. Superhuman generates a state parameter (`googleStateParam`) for CSRF protection
5. Browser redirects to OAuth provider's authorization endpoint
6. User authenticates and grants permissions
7. OAuth provider redirects back to Superhuman with authorization code
8. Superhuman backend exchanges code for access + refresh tokens
9. Tokens stored securely; metadata stored in localStorage
10. User redirected to `mail.superhuman.com/{email}`

### Token Refresh Flow

Superhuman handles token refresh transparently:

1. `credential._refreshToken()` or similar method called when token expires
2. Refresh token exchanged for new access token
3. New access token used for subsequent API calls
4. This happens in the background/service worker context

### Multi-Account Support

Superhuman supports multiple linked accounts:

- Each account stored in the `logins` array
- Switching accounts: navigate to `mail.superhuman.com/{email}`
- Each account has independent OAuth tokens
- `window.GoogleAccount` reflects the currently active account

---

## Internal JavaScript APIs

### Credential Access

```javascript
// The credential object (tokens are protected)
window.GoogleAccount.credential

// Backend credential (for Superhuman API calls)
window.GoogleAccount.backend._credential
```

### Portal Service (RPC Layer)

The portal service proxies API calls through a background/service worker:

```javascript
// Pattern for authenticated API calls
await window.GoogleAccount.portal.invoke(serviceName, methodName, args)

// Examples
await portal.invoke("threadInternal", "listAsync", ["INBOX", { limit: 10 }])
await portal.invoke("messageInternal", "getAsync", [messageId])
```

The portal handles:
- Token injection into requests
- Token refresh when needed
- Request routing to appropriate provider API

### Direct Service Access

For write operations, Superhuman provides service objects:

```javascript
// Gmail operations
const gmail = window.GoogleAccount.di.get('gmail')
await gmail.changeLabelsPerThread(threadId, addLabels, removeLabels)

// Microsoft Graph operations
const msgraph = window.GoogleAccount.di.get('msgraph')
await msgraph.updateMessages(messageIds, { isRead: true })

// Superhuman backend
const backend = window.GoogleAccount.backend
await backend.createReminder(reminderData, options)
```

---

## CLI Authentication Strategy

### Current Approach: CDP Proxy

The superhuman-cli uses Chrome DevTools Protocol (CDP) to:
1. Connect to a running Superhuman instance
2. Execute JavaScript in the page context
3. Use authenticated APIs through `window.GoogleAccount`

This approach:
- Reuses existing OAuth session from Superhuman
- No need to implement OAuth flow
- Works with both Google and Microsoft accounts
- Automatically benefits from token refresh

### Alternative: Direct OAuth (Not Implemented)

To implement standalone CLI authentication:

1. Register OAuth application with Google Cloud Console and Azure AD
2. Implement authorization code flow with PKCE
3. Store tokens securely (keychain/credential manager)
4. Implement token refresh logic
5. Make direct API calls to Gmail/Graph APIs

**Challenges:**
- Need Superhuman's OAuth client credentials
- Superhuman backend APIs require additional authentication
- Features like snooze require Superhuman's backend access

---

## Security Considerations

1. **Token Protection**: OAuth tokens are stored securely and not directly accessible
2. **State Parameter**: CSRF protection via `googleStateParam` in localStorage
3. **Scope Validation**: Provider validates requested scopes during OAuth
4. **Session Management**: Each account has independent session state
5. **CDP Access**: Requires Superhuman app launched with `--remote-debugging-port`

---

## API Request Authentication

### Gmail API

```
POST https://gmail.googleapis.com/gmail/v1/users/me/threads/{threadId}/modify
Authorization: Bearer {access_token}
Content-Type: application/json
```

### Microsoft Graph API

```
PATCH https://graph.microsoft.com/v1.0/me/messages/{messageId}
Authorization: Bearer {access_token}
Content-Type: application/json
```

### Superhuman Backend API

```
POST https://mail.superhuman.com/~backend/v3/{endpoint}
Authorization: Bearer {superhuman_token}
Content-Type: application/json
```

The Superhuman backend likely uses a separate token or cookie-based authentication that wraps the OAuth credentials.

---

## References

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Microsoft Identity Platform Documentation](https://docs.microsoft.com/en-us/azure/active-directory/develop/)
- [Gmail API Reference](https://developers.google.com/gmail/api/reference/rest)
- [Microsoft Graph API Reference](https://docs.microsoft.com/en-us/graph/api/overview)
