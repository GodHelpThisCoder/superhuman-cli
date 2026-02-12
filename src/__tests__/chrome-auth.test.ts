import { describe, test, expect } from "bun:test";
import { selectBestToken } from "../token-api";

describe("selectBestToken", () => {
  test("prefers token from /~backend/ endpoint", () => {
    const tokens = [
      {
        url: "https://graph.microsoft.com/v1.0/me",
        token: "provider-jwt",
        email: "a@b.com",
      },
      {
        url: "https://mail.superhuman.com/~backend/v3/userdata.sync",
        token: "backend-jwt",
        email: "a@b.com",
      },
    ];
    expect(selectBestToken(tokens, "a@b.com")).toBe("backend-jwt");
  });

  test("falls back to Firebase issuer when no /~backend/ URL", () => {
    // Build a fake JWT with Firebase issuer
    const payload = {
      iss: "https://securetoken.googleapis.com/superhuman-2f0f3",
      sub: "abc",
    };
    const fakeJwt = `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
    const tokens = [
      { url: "https://some.other.url", token: fakeJwt, email: "a@b.com" },
    ];
    expect(selectBestToken(tokens, "a@b.com")).toBe(fakeJwt);
  });

  test("filters by email", () => {
    const tokens = [
      {
        url: "https://mail.superhuman.com/~backend/v3/userdata.sync",
        token: "wrong-account",
        email: "other@b.com",
      },
      {
        url: "https://mail.superhuman.com/~backend/v3/userdata.sync",
        token: "right-account",
        email: "a@b.com",
      },
    ];
    expect(selectBestToken(tokens, "a@b.com")).toBe("right-account");
  });

  test("returns null when no tokens", () => {
    expect(selectBestToken([], "a@b.com")).toBeNull();
  });

  test("includes tokens with empty email as fallback", () => {
    const tokens = [
      {
        url: "https://mail.superhuman.com/~backend/v3/userdata.sync",
        token: "no-email-token",
        email: "",
      },
    ];
    expect(selectBestToken(tokens, "a@b.com")).toBe("no-email-token");
  });

  test("returns first token as last resort when no backend or Firebase match", () => {
    const tokens = [
      {
        url: "https://some.api.com/data",
        token: "random-token",
        email: "a@b.com",
      },
    ];
    expect(selectBestToken(tokens, "a@b.com")).toBe("random-token");
  });
});
