#!/usr/bin/env bun
/**
 * Account Switch Exploration Script
 *
 * Investigates:
 * 1. All account-related services in the DI container
 * 2. Regional commands for account switching
 * 3. GoogleAccount properties and methods
 * 4. How navigation affects GoogleAccount
 */

import { connectToSuperhuman } from "../superhuman-api";

interface AccountExplorationResult {
  success: boolean;
  error?: string;

  // Current account info
  currentEmail?: string;
  accountList?: string[];

  // GoogleAccount structure
  googleAccountProperties?: string[];
  googleAccountMethods?: Array<{ name: string; argCount: number }>;

  // DI container services
  diServices?: string[];
  accountRelatedServices?: string[];

  // Regional commands
  accountCommands?: Array<{ id: string; title: string; shortcut?: string }>;

  // Navigation info
  currentUrl?: string;
}

async function exploreAccountSwitching(): Promise<void> {
  console.log("=== Account Switch Exploration ===\n");

  const conn = await connectToSuperhuman();
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    process.exit(1);
  }

  const { Runtime } = conn;

  try {
    // Phase 1: Explore GoogleAccount structure
    console.log("--- Phase 1: GoogleAccount Structure ---\n");

    const phase1Result = await Runtime.evaluate({
      expression: `
        (() => {
          try {
            const ga = window.GoogleAccount;
            if (!ga) return { success: false, error: "GoogleAccount not found" };

            const result = {
              success: true,
              currentEmail: ga.emailAddress,
              accountList: ga.accountList?.() || [],
              currentUrl: window.location.href,
            };

            // Get all own properties
            result.googleAccountProperties = Object.getOwnPropertyNames(ga);

            // Get all methods
            const methods = [];
            const allProps = new Set([
              ...Object.getOwnPropertyNames(ga),
              ...Object.getOwnPropertyNames(Object.getPrototypeOf(ga) || {})
            ]);

            for (const name of allProps) {
              try {
                if (typeof ga[name] === 'function') {
                  methods.push({ name, argCount: ga[name].length });
                }
              } catch (e) {}
            }
            result.googleAccountMethods = methods.sort((a, b) => a.name.localeCompare(b.name));

            return result;
          } catch (e) {
            return { success: false, error: e.message };
          }
        })()
      `,
      returnByValue: true,
    });

    const p1 = phase1Result.result.value as AccountExplorationResult;
    console.log("Current email:", p1.currentEmail);
    console.log("Account list:", p1.accountList);
    console.log("Current URL:", p1.currentUrl);
    console.log("\nGoogleAccount properties:", p1.googleAccountProperties?.join(", "));
    console.log("\nGoogleAccount methods:");
    p1.googleAccountMethods?.forEach(m => console.log(`  - ${m.name}(${m.argCount} args)`));

    // Phase 2: Explore DI container for account-related services
    console.log("\n--- Phase 2: DI Container Services ---\n");

    const phase2Result = await Runtime.evaluate({
      expression: `
        (() => {
          try {
            const di = window.GoogleAccount?.di;
            if (!di) return { success: false, error: "DI container not found" };

            const result = { success: true };

            // Common service names to check
            const servicesToCheck = [
              'accountSwitcher', 'accounts', 'accountManager', 'accountService',
              'auth', 'authentication', 'session', 'user', 'userService',
              'navigation', 'router', 'history', 'routeService',
              'gmail', 'msgraph', 'isMicrosoft', 'gcal',
              'viewState', 'appState', 'state',
              'eventBus', 'events', 'dispatcher', 'emitter',
              'commands', 'commandManager', 'shortcutManager'
            ];

            result.diServices = [];
            result.accountRelatedServices = [];

            for (const name of servicesToCheck) {
              const service = di.get?.(name);
              if (service !== undefined) {
                result.diServices.push(name);
                if (name.toLowerCase().includes('account') ||
                    name.toLowerCase().includes('user') ||
                    name.toLowerCase().includes('auth')) {
                  result.accountRelatedServices.push(name);
                }
              }
            }

            // Also check if di has a way to list all services
            if (typeof di.keys === 'function') {
              result.allDiKeys = di.keys();
            } else if (di._services) {
              result.allDiKeys = Object.keys(di._services);
            } else if (di._map) {
              result.allDiKeys = Array.from(di._map.keys());
            }

            return result;
          } catch (e) {
            return { success: false, error: e.message };
          }
        })()
      `,
      returnByValue: true,
    });

    const p2 = phase2Result.result.value as any;
    console.log("Found DI services:", p2.diServices?.join(", "));
    console.log("Account-related services:", p2.accountRelatedServices?.join(", "));
    if (p2.allDiKeys) {
      console.log("\nAll DI keys:", p2.allDiKeys?.join(", "));
    }

    // Phase 3: Find account-related regional commands
    console.log("\n--- Phase 3: Regional Commands ---\n");

    const phase3Result = await Runtime.evaluate({
      expression: `
        (() => {
          try {
            const rc = window.ViewState?.regionalCommands;
            if (!rc) return { success: false, error: "Regional commands not found" };

            const result = { success: true, accountCommands: [] };

            const searchTerms = ['account', 'switch', 'user', 'profile'];

            for (const region of rc) {
              if (region?.commands) {
                for (const cmd of region.commands) {
                  const idLower = (cmd.id || '').toLowerCase();
                  const titleLower = (cmd.title || '').toLowerCase();

                  // Find account-related commands
                  const isAccountRelated = searchTerms.some(term =>
                    idLower.includes(term) || titleLower.includes(term)
                  );

                  if (isAccountRelated) {
                    result.accountCommands.push({
                      id: cmd.id,
                      title: cmd.title,
                      shortcut: cmd.shortcut,
                    });
                  }
                }
              }
            }

            // Also find any shortcut commands (1-9 might be account shortcuts)
            for (const region of rc) {
              if (region?.commands) {
                for (const cmd of region.commands) {
                  const shortcut = cmd.shortcut || '';
                  if (/^[1-9]$/.test(shortcut) || shortcut.includes('Cmd+') && /[1-9]/.test(shortcut)) {
                    result.accountCommands.push({
                      id: cmd.id,
                      title: cmd.title,
                      shortcut: cmd.shortcut,
                    });
                  }
                }
              }
            }

            return result;
          } catch (e) {
            return { success: false, error: e.message };
          }
        })()
      `,
      returnByValue: true,
    });

    const p3 = phase3Result.result.value as any;
    console.log("Account-related commands:");
    p3.accountCommands?.forEach((c: any) => {
      console.log(`  - ${c.id}: "${c.title}" [${c.shortcut || 'no shortcut'}]`);
    });

    // Phase 4: Check navigateTo method
    console.log("\n--- Phase 4: GoogleAccount.navigateTo ---\n");

    const phase4Result = await Runtime.evaluate({
      expression: `
        (() => {
          try {
            const ga = window.GoogleAccount;
            if (!ga) return { success: false, error: "GoogleAccount not found" };

            const result = { success: true };

            // Check if navigateTo exists
            result.hasNavigateTo = typeof ga.navigateTo === 'function';

            if (result.hasNavigateTo) {
              result.navigateToCode = ga.navigateTo.toString().substring(0, 500);
            }

            // Check for switch-related methods
            const switchMethods = [];
            for (const key of Object.getOwnPropertyNames(ga)) {
              if (key.toLowerCase().includes('switch') ||
                  key.toLowerCase().includes('change') ||
                  key.toLowerCase().includes('select')) {
                switchMethods.push(key);
              }
            }
            result.switchMethods = switchMethods;

            // Check for router/history
            result.hasRouter = !!ga.router;
            result.hasHistory = !!ga.history;

            return result;
          } catch (e) {
            return { success: false, error: e.message };
          }
        })()
      `,
      returnByValue: true,
    });

    const p4 = phase4Result.result.value as any;
    console.log("Has navigateTo:", p4.hasNavigateTo);
    if (p4.navigateToCode) {
      console.log("navigateTo code:", p4.navigateToCode);
    }
    console.log("Switch-related methods:", p4.switchMethods?.join(", ") || "none");
    console.log("Has router:", p4.hasRouter);
    console.log("Has history:", p4.hasHistory);

    // Phase 5: Test navigateTo behavior
    console.log("\n--- Phase 5: Test navigateTo behavior ---\n");

    if (p1.accountList && p1.accountList.length > 1) {
      const targetEmail = p1.accountList.find((e: string) => e !== p1.currentEmail);
      if (targetEmail) {
        console.log(`Current: ${p1.currentEmail}`);
        console.log(`Target: ${targetEmail}`);
        console.log(`Testing navigateTo('/${targetEmail}')...`);

        const navResult = await Runtime.evaluate({
          expression: `
            (() => {
              try {
                const ga = window.GoogleAccount;
                const beforeEmail = ga.emailAddress;

                // Try navigateTo
                if (typeof ga.navigateTo === 'function') {
                  ga.navigateTo('/${targetEmail}');
                }

                return {
                  success: true,
                  beforeEmail,
                  afterEmail: ga.emailAddress,
                  urlAfter: window.location.href,
                };
              } catch (e) {
                return { success: false, error: e.message };
              }
            })()
          `.replace('${targetEmail}', targetEmail),
          returnByValue: true,
        });

        const nav = navResult.result.value as any;
        console.log("Before email:", nav.beforeEmail);
        console.log("After email (immediate):", nav.afterEmail);
        console.log("URL after:", nav.urlAfter);

        // Wait and check again
        await new Promise(r => setTimeout(r, 2000));

        const checkResult = await Runtime.evaluate({
          expression: `({ email: window.GoogleAccount?.emailAddress, url: window.location.href })`,
          returnByValue: true,
        });

        const check = checkResult.result.value as any;
        console.log("After 2s - email:", check.email);
        console.log("After 2s - URL:", check.url);
      }
    }

    // Phase 6: List all regional commands to find keyboard shortcuts
    console.log("\n--- Phase 6: All Keyboard Shortcuts ---\n");

    const phase6Result = await Runtime.evaluate({
      expression: `
        (() => {
          try {
            const rc = window.ViewState?.regionalCommands;
            if (!rc) return { success: false, error: "Regional commands not found" };

            const shortcuts = [];

            for (const region of rc) {
              if (region?.commands) {
                for (const cmd of region.commands) {
                  if (cmd.shortcut) {
                    shortcuts.push({
                      id: cmd.id,
                      title: cmd.title || '',
                      shortcut: cmd.shortcut,
                    });
                  }
                }
              }
            }

            // Sort by shortcut
            shortcuts.sort((a, b) => a.shortcut.localeCompare(b.shortcut));

            return { success: true, shortcuts };
          } catch (e) {
            return { success: false, error: e.message };
          }
        })()
      `,
      returnByValue: true,
    });

    const p6 = phase6Result.result.value as any;
    console.log("All shortcuts (sorted):");
    p6.shortcuts?.forEach((s: any) => {
      console.log(`  [${s.shortcut}] ${s.id}: ${s.title}`);
    });

  } finally {
    await conn.client.close();
  }
}

exploreAccountSwitching().catch(console.error);
