# Superhuman Write Operations API Documentation

> Generated: 2026-01-31T06:49:46.581Z

This document captures HTTP requests made by Superhuman when performing write operations.

## Overview

Superhuman uses a combination of:
- **Gmail API** for Google accounts (`googleapis.com/gmail`)
- **Microsoft Graph API** for Outlook accounts (`graph.microsoft.com`)
- **Superhuman Backend API** for features like snooze/reminders

---

## API Pattern Summary

### Gmail API Endpoints

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Archive | POST | `/gmail/v1/users/me/threads/{threadId}/modify` |
| Add Label | POST | `/gmail/v1/users/me/threads/{threadId}/modify` |
| Remove Label | POST | `/gmail/v1/users/me/threads/{threadId}/modify` |
| Star | POST | `/gmail/v1/users/me/threads/{threadId}/modify` |
| Mark Read | POST | `/gmail/v1/users/me/threads/{threadId}/modify` |
| Save Draft | POST | `/gmail/v1/users/me/drafts` |
| Update Draft | PUT | `/gmail/v1/users/me/drafts/{draftId}` |
| Send | POST | `/gmail/v1/users/me/messages/send` |

### Microsoft Graph Endpoints

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Archive | POST | `/v1.0/me/messages/{messageId}/move` |
| Star (Flag) | PATCH | `/v1.0/me/messages/{messageId}` |
| Mark Read | PATCH | `/v1.0/me/messages/{messageId}` |
| Save Draft | POST | `/v1.0/me/messages` |
| Send | POST | `/v1.0/me/sendMail` |

### Superhuman Backend

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Snooze | POST | `mail.superhuman.com/api/reminders` |
| Unsnooze | DELETE | `mail.superhuman.com/api/reminders/{reminderId}` |
