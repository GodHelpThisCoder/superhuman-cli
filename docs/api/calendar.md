# Superhuman Calendar API Documentation

> Last Updated: 2026-02-02
> Discovery Method: CDP Runtime.evaluate exploration

## Overview

Superhuman's calendar functionality is exposed through the `gcal` service in the DI container for Google accounts. The service wraps the Google Calendar API.

## Service Access

```javascript
// Access gcal service
const gcal = window.GoogleAccount.di.get('gcal');

// Service has these dependencies
gcal._di      // DI container
gcal._backend // Backend service for API calls
```

## Available Methods

### Event Operations

| Method | Purpose | Parameters |
|--------|---------|------------|
| `getEventsList()` | List calendar events | `(calendarId, timeMin, timeMax, options)` |
| `getEvent()` | Get single event | `(calendarId, eventId)` |
| `importEvent()` | Create/import event | `(calendarId, eventData)` |
| `patchEvent()` | Update event | `(calendarId, eventId, patchData)` |
| `deleteEvent()` | Delete event | `(calendarId, eventId)` |
| `deleteInstanceAndFollowing()` | Delete recurring instance + future | `(calendarId, eventId)` |

### Recurrence Operations

| Method | Purpose |
|--------|---------|
| `getRecurrenceInstanceFromCalendar()` | Get specific recurrence instance |
| `getRecurrenceInstanceId()` | Get recurrence instance ID |

### Availability

| Method | Purpose |
|--------|---------|
| `queryFreeBusy()` | Check free/busy for time range |
| `listCalendarList()` | List all calendars for account |

### Meeting & Location

| Method | Purpose |
|--------|---------|
| `createConferenceData()` | Create Google Meet/conference link |
| `getLocationAutocompleteSuggestions()` | Location autocomplete |
| `getPlaceDetails()` | Get location details |

### Internal Methods

| Method | Purpose |
|--------|---------|
| `_getAsync()` | GET request |
| `_putAsync()` | PUT request |
| `_patchAsync()` | PATCH request |
| `_deleteAsync()` | DELETE request |
| `_postAsync()` | POST request |
| `_fetchWithMethod()` | Generic fetch |
| `_fetch()` | Base fetch |
| `_updateEvent()` | Internal event update |

## ViewState Calendar Data

Calendar data is cached in ViewState tree:

```javascript
const tree = window.ViewState.tree.get();

// Calendar-related keys
tree.calendar           // Calendar state and cache
tree.calendarMode       // Current view mode
tree.isCreatingEvent    // Event creation state
tree.attendeeCalendars  // Attendee calendar data
tree.isCreatingEventWithAI  // AI event creation
```

### Event Cache Structure

Events are cached by date in `tree.calendar.cache`:

```javascript
tree.calendar.cache = {
  "2026-01-26": [
    {
      kind: "calendar#event",
      id: "eventId123",
      status: "confirmed",
      summary: "Meeting Title",
      description: "Description",

      // Time data
      start: {},
      end: {},
      rawStart: {
        dateTime: "2026-01-26T13:00:00-05:00",
        timeZone: "America/New_York"
      },
      rawEnd: {
        dateTime: "2026-01-26T14:00:00-05:00",
        timeZone: "America/New_York"
      },
      allDay: false,

      // Recurrence
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
      recurringEventId: "baseEventId",
      originalStartTime: { dateTime: "..." },

      // Participants
      creator: { email: "user@gmail.com", self: true },
      organizer: { email: "user@gmail.com", self: true },
      attendees: [
        { email: "attendee@example.com", responseStatus: "accepted" }
      ],

      // Metadata
      calendarId: "user@gmail.com",
      accountEmail: "user@gmail.com",
      source: "api",
      provider: "google",
      accessRole: "owner",
      isOrganizer: true,

      // Conference
      conferenceData: { ... },

      // Links
      htmlLink: "https://calendar.google.com/...",
      iCalUID: "eventId@google.com"
    }
  ],
  "2026-01-27": [ ... ]
}
```

## Implementation Patterns

### List Events

```javascript
const gcal = window.GoogleAccount.di.get('gcal');
const calendarId = 'primary'; // or email address

const events = await gcal.getEventsList(
  calendarId,
  new Date().toISOString(),           // timeMin
  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // timeMax (7 days)
  { singleEvents: true, orderBy: 'startTime' }
);
```

### Create Event

```javascript
const eventData = {
  summary: "Meeting Title",
  description: "Meeting description",
  start: {
    dateTime: "2026-02-03T10:00:00-05:00",
    timeZone: "America/New_York"
  },
  end: {
    dateTime: "2026-02-03T11:00:00-05:00",
    timeZone: "America/New_York"
  },
  attendees: [
    { email: "attendee@example.com" }
  ]
};

const created = await gcal.importEvent(calendarId, eventData);
```

### Update Event

```javascript
const patch = {
  summary: "Updated Title",
  start: {
    dateTime: "2026-02-03T14:00:00-05:00",
    timeZone: "America/New_York"
  }
};

await gcal.patchEvent(calendarId, eventId, patch);
```

### Delete Event

```javascript
await gcal.deleteEvent(calendarId, eventId);
```

### Check Availability

```javascript
const freeBusy = await gcal.queryFreeBusy({
  timeMin: new Date().toISOString(),
  timeMax: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  items: [{ id: calendarId }]
});
```

## Microsoft/Outlook (msgraph service)

For Microsoft accounts, the `msgraph` service provides calendar functionality.

### Service Access

```javascript
const msgraph = window.GoogleAccount.di.get('msgraph');
```

### Available Methods

| Method | Purpose |
|--------|---------|
| `calendarView(startDateTime, endDateTime)` | List events for time range |
| `calendarViewDelta()` | Incremental sync |
| `calendarViewDeltaNextLink()` | Pagination for delta sync |
| `getEvent(eventId)` | Get single event |
| `updateEvent(eventId, data)` | Update/create event |
| `deleteEvent(eventId)` | Delete event |
| `deleteInstanceAndFollowing(eventId)` | Delete recurring instance + future |
| `respondToEvent(eventId, response)` | RSVP (accept/decline/tentative) |
| `getCalendars()` | List all calendars |
| `fetchTeamAvailability()` | Check team availability |

### Implementation Patterns

#### List Events
```javascript
const msgraph = window.GoogleAccount.di.get('msgraph');
const startDateTime = new Date().toISOString();
const endDateTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const events = await msgraph.calendarView(startDateTime, endDateTime);
```

#### Create/Update Event
```javascript
const eventData = {
  subject: "Meeting Title",
  body: { contentType: "HTML", content: "Description" },
  start: { dateTime: "2026-02-03T10:00:00", timeZone: "Eastern Standard Time" },
  end: { dateTime: "2026-02-03T11:00:00", timeZone: "Eastern Standard Time" },
  attendees: [
    { emailAddress: { address: "attendee@example.com" }, type: "required" }
  ]
};
await msgraph.updateEvent(eventId, eventData);
```

#### Delete Event
```javascript
await msgraph.deleteEvent(eventId);
```

#### RSVP
```javascript
// response: "accept" | "decline" | "tentative"
await msgraph.respondToEvent(eventId, "accept");
```

### Microsoft Graph Event Structure

Microsoft Graph events differ from Google Calendar:

```javascript
{
  id: "AAMkAGI2...",
  subject: "Meeting Title",
  bodyPreview: "Description preview",
  body: { contentType: "html", content: "..." },
  start: { dateTime: "2026-02-03T10:00:00.0000000", timeZone: "Eastern Standard Time" },
  end: { dateTime: "2026-02-03T11:00:00.0000000", timeZone: "Eastern Standard Time" },
  isAllDay: false,
  organizer: { emailAddress: { name: "User", address: "user@company.com" } },
  attendees: [
    {
      emailAddress: { name: "Attendee", address: "attendee@example.com" },
      type: "required",
      status: { response: "accepted", time: "2026-02-01T..." }
    }
  ],
  recurrence: {
    pattern: { type: "weekly", daysOfWeek: ["monday", "wednesday", "friday"] },
    range: { type: "noEnd", startDate: "2026-02-03" }
  },
  webLink: "https://outlook.office365.com/...",
  onlineMeeting: { joinUrl: "https://teams.microsoft.com/..." },
  responseStatus: { response: "organizer", time: "..." }
}
```

## Recurrence (RRULE Format)

Events use standard iCalendar RRULE format:

```
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR    // Weekdays
RRULE:FREQ=DAILY;INTERVAL=1                // Daily
RRULE:FREQ=MONTHLY;BYMONTHDAY=15           // Monthly on 15th
RRULE:FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1   // Yearly on Jan 1
```

## RSVP / Response Status

Attendee response statuses:
- `needsAction` - Not responded
- `accepted` - Accepted
- `declined` - Declined
- `tentative` - Maybe

To update RSVP, use `patchEvent` with attendee updates.

## Next Steps

1. Implement `src/calendar.ts` with gcal service wrapper
2. Add CLI commands for calendar operations
3. Add MCP tools for calendar operations
4. Test with CDP automation
5. Explore Microsoft/Outlook calendar (msgraph)
