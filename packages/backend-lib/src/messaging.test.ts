import { randomUUID } from "crypto";
import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";
import { WorkspaceTypeAppEnum } from "isomorphic-lib/src/types";

import { insert } from "./db";
import {
  messageTemplate as dbMessageTemplate,
  subscriptionGroup as dbSubscriptionGroup,
  workspace as dbWorkspace,
} from "./db/schema";
// Removed duplicated import for sendEmail, sendSms, upsertMessageTemplate
import {
  getEmailProvider,
  sendEmail,
  sendSms,
  upsertMessageTemplate,
} from "./messaging";
import { upsertEmailProvider } from "./messaging/email";
import { upsertSmsProvider } from "./messaging/sms";
import { getAndRefreshGmailAccessToken } from "./gmail";
import { db } from "./db";
import { upsertSubscriptionSecret } from "./subscriptionGroups";
import {
  ChannelType,
  EmailProviderType,
  EmailTemplateResource,
  InternalEventType,
  MessageTags,
  MessageTemplate,
  SmsProviderType,
  SmsTemplateResource,
  SubscriptionGroup,
  SubscriptionGroupType,
  UpsertMessageTemplateValidationErrorType,
  Workspace,
  Secret,
  EmailProviderSecret,
  MessageSendFailure,
  // InternalEventType (removed duplicate)
  BadWorkspaceConfigurationType,
} from "./types";

// Mocking db module
jest.mock("./db", () => ({
  ...jest.requireActual("./db"), // Import and retain default behavior
  db: jest.fn().mockReturnValue({
    query: {
      emailProvider: {
        findFirst: jest.fn(),
      },
      defaultEmailProvider: {
        findFirst: jest.fn(),
      },
      workspace: {
        findFirst: jest.fn(),
      },
      // Add other tables and methods if needed by tests
    },
    // Add other db functions if needed e.g. insert, etc.
  }),
}));

// Mocking individual mail sending functions
jest.mock("./destinations/smtp", () => ({
  sendMail: jest.fn(),
}));
jest.mock("./destinations/sendgrid", () => ({
  sendMail: jest.fn(),
}));
// Add mocks for amazonses, resend, postmark, mailchimp if specific tests need them

// Mocking getSendMessageModels (as it's used by sendEmail)
// We need to mock functions from the same module carefully.
const originalMessagingModule = jest.requireActual("./messaging");
const mockGetSendMessageModelsActual = jest.fn();

jest.mock("./messaging", () => ({
  ...originalMessagingModule,
  getSendMessageModels: mockGetSendMessageModelsActual,
  // getEmailProvider will be tested, but for sendEmail, we want to control its output sometimes
  // or let it run with DB mocks. For now, we are not directly mocking getEmailProvider itself here
  // but relying on DB mocks.
}));

const mockDb = db as jest.MockedFunction<typeof db>;
const mockedSendMailSmtp = jest.requireMock("./destinations/smtp").sendMail;
const mockedSendMailSendgrid =
  jest.requireMock("./destinations/sendgrid").sendMail;
// Use the actual getSendMessageModels mock we defined above
const mockedGetSendMessageModels =
  mockGetSendMessageModelsActual as jest.MockedFunction<any>;

async function setupEmailTemplate(workspace: Workspace) {
  const templatePromise = insert({
    table: dbMessageTemplate,
    values: {
      id: randomUUID(),
      workspaceId: workspace.id,
      name: `template-${randomUUID()}`,
      definition: {
        type: ChannelType.Email,
        from: "support@company.com",
        subject: "Hello",
        body: "{% unsubscribe_link here %}.",
      } satisfies EmailTemplateResource,
      updatedAt: new Date(),
      createdAt: new Date(),
    },
  }).then(unwrap);
  const subscriptionGroupPromise = insert({
    table: dbSubscriptionGroup,
    values: {
      id: randomUUID(),
      workspaceId: workspace.id,
      name: `group-${randomUUID()}`,
      type: "OptOut",
      channel: ChannelType.Email,
      updatedAt: new Date(),
      createdAt: new Date(),
    },
  }).then(unwrap);

  const [template, subscriptionGroup] = await Promise.all([
    templatePromise,
    subscriptionGroupPromise,
    upsertEmailProvider({
      workspaceId: workspace.id,
      config: { type: EmailProviderType.Test },
    }),
    upsertSubscriptionSecret({
      workspaceId: workspace.id,
    }),
  ]);
  return { template, subscriptionGroup };
}

describe("messaging", () => {
  let workspace: Workspace;
  const defaultWorkspaceId = randomUUID();
  const defaultEmailProviderId = randomUUID();
  // const gmailProviderId = randomUUID(); // Removed
  const namedProviderId = randomUUID();

  const testSecretSmtp: Secret = {
    id: randomUUID(),
    workspaceId: defaultWorkspaceId,
    name: "default-smtp", // Corresponds to EmailProviderSecret.name if it were used
    configValue: {
      type: EmailProviderType.Smtp,
      host: "smtp.example.com",
      port: "587",
      username: "user",
      password: "password",
      name: "Default SMTP", // User-defined name
    } satisfies EmailProviderSecret,
    createdAt: new Date(),
    updatedAt: new Date(),
    value: null, // Deprecated
  };

  // const testSecretGmail: Secret = { ... }; // Removed

  const testSecretNamedSmtp: Secret = {
    id: randomUUID(),
    workspaceId: defaultWorkspaceId,
    name: "named-smtp-secret",
    configValue: {
      type: EmailProviderType.Smtp,
      host: "named.smtp.example.com",
      port: "1587",
      username: "named_user",
      password: "named_password",
      name: "My Named SMTP",
    } satisfies EmailProviderSecret,
    createdAt: new Date(),
    updatedAt: new Date(),
    value: null,
  };

  beforeEach(async () => {
    workspace = {
      id: defaultWorkspaceId,
      name: `workspace-${randomUUID()}`,
      type: WorkspaceTypeAppEnum.Root,
      status: "Active",
      domain: null,
      externalId: null,
      parentWorkspaceId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Reset mocks before each test
    mockDb().query.emailProvider.findFirst.mockReset();
    mockDb().query.defaultEmailProvider.findFirst.mockReset();
    mockDb().query.workspace.findFirst.mockReset();
    // mockedGetAndRefreshGmailAccessToken.mockReset(); // Removed

    // Setup default workspace mock for hierarchical lookups
    mockDb().query.workspace.findFirst.mockImplementation(async ({ where }: any) => {
      // Pass `where` through, this is complex to mock generally, adjust per test if needed
      // For now, assume it might be called to check parent workspace, and return null.
      return null;
    });
  });

  describe("getEmailProvider", () => {
    it("should fetch a provider by its UUID id", async () => {
      mockDb().query.emailProvider.findFirst.mockResolvedValueOnce({
        id: namedProviderId,
        workspaceId: defaultWorkspaceId,
        type: EmailProviderType.Smtp,
        secretId: testSecretNamedSmtp.id,
        secret: testSecretNamedSmtp,
        name: "My Named SMTP", // Name in the EmailProvider table
        apiKey: null, // deprecated
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await getEmailProvider({
        workspaceId: defaultWorkspaceId,
        providerNameOrId: namedProviderId,
      });

      expect(result.isOk()).toBe(true);
      const providerSecret = result._unsafeUnwrap();
      expect(providerSecret.type).toBe(EmailProviderType.Smtp);
      expect((providerSecret as any).host).toBe("named.smtp.example.com");
      expect((providerSecret as any).name).toBe("My Named SMTP"); // Name from secret config
    });

    it("should fetch a provider by its string name", async () => {
      const providerName = "My Named SMTP";
      mockDb().query.emailProvider.findFirst.mockResolvedValueOnce({
        id: namedProviderId,
        workspaceId: defaultWorkspaceId,
        type: EmailProviderType.Smtp,
        secretId: testSecretNamedSmtp.id,
        secret: testSecretNamedSmtp,
        name: providerName, // Name in the EmailProvider table
        apiKey: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await getEmailProvider({
        workspaceId: defaultWorkspaceId,
        providerNameOrId: providerName,
      });

      expect(result.isOk()).toBe(true);
      const providerSecret = result._unsafeUnwrap();
      expect(providerSecret.type).toBe(EmailProviderType.Smtp);
      expect((providerSecret as any).host).toBe("named.smtp.example.com");
      expect((providerSecret as any).name).toBe(providerName); // Name from secret config
    });

    it("should fall back to default provider if specific provider by name/id not found", async () => {
      mockDb().query.emailProvider.findFirst.mockResolvedValueOnce(undefined); // Simulate not found
      mockDb().query.defaultEmailProvider.findFirst.mockResolvedValueOnce({
        workspaceId: defaultWorkspaceId,
        emailProviderId: defaultEmailProviderId,
        emailProvider: {
          id: defaultEmailProviderId,
          workspaceId: defaultWorkspaceId,
          type: EmailProviderType.Smtp,
          secretId: testSecretSmtp.id,
          secret: testSecretSmtp,
          name: null,
          apiKey: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        fromAddress: null,
      });

      const result = await getEmailProvider({
        workspaceId: defaultWorkspaceId,
        providerNameOrId: "non-existent-provider",
      });

      expect(result.isOk()).toBe(true);
      const providerSecret = result._unsafeUnwrap();
      expect(providerSecret.type).toBe(EmailProviderType.Smtp);
      expect((providerSecret as any).host).toBe("smtp.example.com");
      expect((providerSecret as any).name).toBe("Default SMTP");
    });

    it("should return error if provider by name/id found but secret is invalid", async () => {
      const invalidSecretConfig = { ...testSecretNamedSmtp, configValue: { type: "InvalidType" } };
      mockDb().query.emailProvider.findFirst.mockResolvedValueOnce({
        id: namedProviderId,
        workspaceId: defaultWorkspaceId,
        type: EmailProviderType.Smtp,
        secretId: invalidSecretConfig.id,
        secret: invalidSecretConfig as any, // Cast to avoid type error in mock setup
        name: "My Named SMTP",
        apiKey: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
       // Mock default provider to ensure fallback doesn't happen if we expect error
      mockDb().query.defaultEmailProvider.findFirst.mockResolvedValueOnce(undefined);


      const result = await getEmailProvider({
        workspaceId: defaultWorkspaceId,
        providerNameOrId: namedProviderId,
      });

      // Current implementation falls through. If strict error is preferred, this test changes.
      // This test assumes that if a provider is found by name/id but its secret is invalid,
      // getEmailProvider will try to fall back. If no default is found, it returns PROVIDER_NOT_FOUND_ERROR.
      // If a more specific "invalid config for provider X" error is desired before fallback,
      // the implementation of getEmailProvider and this test would change.
      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.type).toBe(InternalEventType.BadWorkspaceConfiguration);
      expect(error.variant.type).toBe(
        BadWorkspaceConfigurationType.MessageServiceProviderNotFound,
      );
    });

    // Removed: describe("when fetching Gmail provider by name/id", () => { ... });
    // Removed: it("should use providerOverride for Gmail if providerNameOrId is not provided", async () => { ... });

    it("should fetch default workspace provider if no overrides are given", async () => {
        mockDb().query.defaultEmailProvider.findFirst.mockResolvedValueOnce({
        workspaceId: defaultWorkspaceId,
        emailProviderId: defaultEmailProviderId,
        emailProvider: {
          id: defaultEmailProviderId,
          workspaceId: defaultWorkspaceId,
          type: EmailProviderType.Smtp,
          secretId: testSecretSmtp.id,
          secret: testSecretSmtp,
          name: null,
          apiKey: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        fromAddress: null,
      });

      const result = await getEmailProvider({
        workspaceId: defaultWorkspaceId,
      });

      expect(result.isOk()).toBe(true);
      const providerSecret = result._unsafeUnwrap();
      expect(providerSecret.type).toBe(EmailProviderType.Smtp);
      expect((providerSecret as any).host).toBe("smtp.example.com");
    });

  });

  describe("sendEmail", () => {
    const userId = "user-id-for-sendEmail";
    const userEmail = "testuser@example.com";
    const templateId = randomUUID();
    const messageId = randomUUID();

    beforeEach(() => {
      // Reset mocks for mail sending functions
      mockedSendMailSmtp.mockReset();
      mockedSendMailSendgrid.mockReset();
      mockedGetSendMessageModels.mockReset();

      // Default mock for getSendMessageModels
      mockedGetSendMessageModels.mockResolvedValue(
        ok({
          messageTemplateDefinition: {
            type: ChannelType.Email,
            from: "test@example.com",
            subject: "Test Subject",
            body: "Test Body",
          } satisfies EmailTemplateResource,
          subscriptionGroupSecret: null,
        }),
      );
    });

    it("should call getEmailProvider with providerNameOrId and use the resolved SMTP provider", async () => {
      const providerName = "MySpecificSmtpProvider";
      const specificSmtpSecret: EmailProviderSecret = {
        type: EmailProviderType.Smtp,
        host: "specific.smtp.example.com",
        port: "5587",
        username: "specific_user",
        password: "specific_password",
        name: providerName,
      };
      // Mock the DB call that getEmailProvider uses
      mockDb().query.emailProvider.findFirst.mockImplementation(async ({ where }: any) => {
        // This is a simplified mock. A real scenario might need more precise matching of `where`.
        const whereString = JSON.stringify(where);
        if (whereString.includes(providerName) && !whereString.includes("id")) { // Check if filtering by name
          return {
            id: randomUUID(),
            workspaceId: defaultWorkspaceId,
            type: EmailProviderType.Smtp, // DB stores this as text
            secretId: randomUUID(),
            secret: { configValue: specificSmtpSecret, name: "secret-"+providerName } as Secret,
            name: providerName, // Name in the EmailProvider table
            apiKey: null, createdAt: new Date(), updatedAt: new Date(),
          };
        }
        return undefined;
      });
      mockedSendMailSmtp.mockResolvedValue(ok({ messageId: "smtp-message-id" }));

      await sendEmail({
        workspaceId: defaultWorkspaceId,
        templateId,
        providerNameOrId: providerName,
        userId,
        userPropertyAssignments: { id: userId, email: userEmail },
        useDraft: false,
        messageTags: { messageId } as MessageTags,
      });

      expect(mockDb().query.emailProvider.findFirst).toHaveBeenCalled();
      expect(mockedSendMailSmtp).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "specific.smtp.example.com",
          username: "specific_user",
        }),
      );
    });

    it("should call getEmailProvider with providerNameOrId (an ID) and use the resolved SendGrid provider", async () => {
      const providerId = randomUUID(); // Test with ID
      const specificSendgridSecret: EmailProviderSecret = {
        type: EmailProviderType.SendGrid,
        apiKey: "SG.specific-api-key",
        name: "MySpecificSendgridById",
      };
      mockDb().query.emailProvider.findFirst.mockImplementation(async ({ where }: any) => {
         const whereString = JSON.stringify(where);
         if (whereString.includes(providerId)) { // Check if filtering by ID
          return {
            id: providerId,
            workspaceId: defaultWorkspaceId,
            type: EmailProviderType.SendGrid, // DB stores this as text
            secretId: randomUUID(),
            secret: { configValue: specificSendgridSecret, name:"secret-"+providerId } as Secret,
            name: "MySpecificSendgridById", // Name in DB
            apiKey: null, createdAt: new Date(), updatedAt: new Date(),
          };
        }
        return undefined;
      });
      mockedSendMailSendgrid.mockResolvedValue(ok({}));

      await sendEmail({
        workspaceId: defaultWorkspaceId,
        templateId,
        providerNameOrId: providerId,
        userId,
        userPropertyAssignments: { id: userId, email: userEmail },
        useDraft: false,
        messageTags: { messageId } as MessageTags,
      });

      expect(mockDb().query.emailProvider.findFirst).toHaveBeenCalled();
      expect(mockedSendMailSendgrid).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "SG.specific-api-key",
        }),
      );
    });

    // This test ensures that the existing logic for child workspace + providerOverride still works
    // by falling back through getEmailProvider if providerNameOrId is not supplied.
    describe("when sent from a child workspace (legacy providerOverride)", () => {
      let childWorkspace: Workspace;
      let parentWorkspaceReal: Workspace; // Use a different name to avoid conflict with outer scope
      let templateReal: MessageTemplate;
      let subscriptionGroupReal: SubscriptionGroup;

      beforeEach(async () => {
        // This setup involves real DB inserts for workspace, template, etc.
        // It's more of an integration test for this specific scenario.
        // We need to ensure mocks for getEmailProvider's DB calls are specific enough
        // or reset if they interfere.
        mockDb().query.emailProvider.findFirst.mockReset(); // Reset general mocks
        mockDb().query.defaultEmailProvider.findFirst.mockReset();
        mockDb().query.workspace.findFirst.mockReset();

        const parentWorkspaceId = randomUUID();
        parentWorkspaceReal = await insert({
          table: dbWorkspace,
          values: {
            id: parentWorkspaceId,
            name: `parent-workspace-${randomUUID()}`,
            type: WorkspaceTypeAppEnum.Parent,
          },
        }).then(unwrap);

        childWorkspace = await insert({
          table: dbWorkspace,
          values: {
            id: randomUUID(),
            parentWorkspaceId,
            name: `child-workspace-${randomUUID()}`,
            type: WorkspaceTypeAppEnum.Child,
          },
        }).then(unwrap);

        const setup = await setupEmailTemplate(childWorkspace);
        templateReal = setup.template;
        subscriptionGroupReal = setup.subscriptionGroup;

        // Setup default provider on parent
        await upsertEmailProvider({
          workspaceId: parentWorkspaceReal.id,
          config: { type: EmailProviderType.Test, name:"ParentTest" },
        });

        // Mock the hierarchical lookup for the parent's provider
        // This is what getEmailProviderSecretForWorkspaceHierarchical would do
        mockDb().query.defaultEmailProvider.findFirst.mockImplementation(async ({where: defaultWhere}: any) => {
          const defaultWhereString = JSON.stringify(defaultWhere);
          if (defaultWhereString.includes(childWorkspace.id)) return undefined; // No default on child
          if (defaultWhereString.includes(parentWorkspaceReal.id)) { // Default on parent
            return {
              emailProvider: {
                secret: { configValue: { type: EmailProviderType.Test, name: "ParentTest" } } as Secret,
                 type: EmailProviderType.Test,
              } as any, // Simplified mock
            } as any;
          }
          return undefined;
        });
        mockDb().query.workspace.findFirst.mockImplementation(async ({where: wsWhere}: any) => {
          const wsWhereString = JSON.stringify(wsWhere);
          if (wsWhereString.includes(childWorkspace.id)) return childWorkspace;
          if (wsWhereString.includes(parentWorkspaceReal.id)) return parentWorkspaceReal;
          return undefined;
        });

      });

      it("should use the parent workspace's email provider via providerOverride", async () => {
        const result = await sendEmail({
          workspaceId: childWorkspace.id,
          templateId: templateReal.id,
          providerOverride: EmailProviderType.Test, // This should trigger lookup via hierarchy
          userId,
          userPropertyAssignments: { id: userId, email: userEmail },
          useDraft: false,
          messageTags: { messageId } as MessageTags,
           subscriptionGroupDetails: {
            id: subscriptionGroupReal.id,
            name: subscriptionGroupReal.name,
            type: SubscriptionGroupType.OptOut,
            action: null,
          },
        });

        expect(result.isOk()).toBe(true);
        const messageSent = result._unsafeUnwrap();
        expect(messageSent.type).toBe(InternalEventType.MessageSent);
        if (messageSent.type === InternalEventType.MessageSent && messageSent.variant.type === ChannelType.Email) {
          // Check if it used the Test provider (which doesn't call a specific sendMail mock here)
          expect(messageSent.variant.provider.type).toBe(EmailProviderType.Test);
        } else {
          throw new Error("Expected email sent with Test provider");
        }
      });
    });


    describe("when sent from a child workspace", () => {
      let childWorkspace: Workspace;
      let parentWorkspace: Workspace;
      let template: MessageTemplate;
      let subscriptionGroup: SubscriptionGroup;

      beforeEach(async () => {
        const parentWorkspaceId = randomUUID();
        [parentWorkspace, childWorkspace] = await Promise.all([
          insert({
            table: dbWorkspace,
            values: {
              id: parentWorkspaceId,
              name: `parent-workspace-${randomUUID()}`,
              type: WorkspaceTypeAppEnum.Parent,
              updatedAt: new Date(),
              createdAt: new Date(),
            },
          }).then(unwrap),
          insert({
            table: dbWorkspace,
            values: {
              id: randomUUID(),
              parentWorkspaceId,
              name: `child-workspace-${randomUUID()}`,
              type: WorkspaceTypeAppEnum.Child,
              updatedAt: new Date(),
              createdAt: new Date(),
            },
          }).then(unwrap),
        ]);
        [template, subscriptionGroup] = await Promise.all([
          insert({
            table: dbMessageTemplate,
            values: {
              id: randomUUID(),
              workspaceId: childWorkspace.id,
              name: `template-${randomUUID()}`,
              updatedAt: new Date(),
              createdAt: new Date(),
              definition: {
                type: ChannelType.Email,
                from: "support@company.com",
                subject: "Hello",
                body: "{% unsubscribe_link here %}.",
              } satisfies EmailTemplateResource,
            },
          }).then(unwrap),
          insert({
            table: dbSubscriptionGroup,
            values: {
              id: randomUUID(),
              workspaceId: childWorkspace.id,
              name: `group-${randomUUID()}`,
              type: "OptOut",
              channel: ChannelType.Email,
              updatedAt: new Date(),
              createdAt: new Date(),
            },
          }).then(unwrap),
          upsertSubscriptionSecret({
            workspaceId: childWorkspace.id,
          }),
          upsertEmailProvider({
            workspaceId: parentWorkspace.id,
            config: { type: EmailProviderType.Test },
          }),
        ]);
      });

      it("should use the parent workspace's email provider", async () => {
        const userId = 1234;
        const email = "test@email.com";

        const payload = await sendEmail({
          workspaceId: childWorkspace.id,
          templateId: template.id,
          messageTags: {
            workspaceId: childWorkspace.id,
            templateId: template.id,
            runId: "run-id-1",
            nodeId: "node-id-1",
            messageId: "message-id-1",
          } satisfies MessageTags,
          userPropertyAssignments: {
            id: userId,
            email,
          },
          userId: String(userId),
          useDraft: false,
          subscriptionGroupDetails: {
            id: subscriptionGroup.id,
            name: subscriptionGroup.name,
            type: SubscriptionGroupType.OptOut,
            action: null,
          },
          providerOverride: EmailProviderType.Test,
        });
        const unwrapped = unwrap(payload);
        expect(unwrapped.type).toBe(InternalEventType.MessageSent);
      });
    });

    describe("when an email to a user with a numeric id includes an unsusbcribe link tag", () => {
      let template: MessageTemplate;
      let subscriptionGroup: SubscriptionGroup;
      beforeEach(async () => {
        ({ template, subscriptionGroup } = await setupEmailTemplate(workspace));
      });
      it("should render the tag", async () => {
        const userId = 1234;
        const email = "test@email.com";

        const payload = await sendEmail({
          workspaceId: workspace.id,
          templateId: template.id,
          messageTags: {
            workspaceId: workspace.id,
            templateId: template.id,
            runId: "run-id-1",
            nodeId: "node-id-1",
            messageId: "message-id-1",
          } satisfies MessageTags,
          userPropertyAssignments: {
            id: userId,
            email,
          },
          userId: String(userId),
          useDraft: false,
          subscriptionGroupDetails: {
            id: subscriptionGroup.id,
            name: subscriptionGroup.name,
            type: SubscriptionGroupType.OptOut,
            action: null,
          },
          providerOverride: EmailProviderType.Test,
        });
        const unwrapped = unwrap(payload);
        if (unwrapped.type === InternalEventType.MessageSkipped) {
          throw new Error("Message should not be skipped");
        }
        expect(unwrapped.type).toBe(InternalEventType.MessageSent);
        expect(unwrapped.variant.to).toBe(email);

        if (unwrapped.variant.type !== ChannelType.Email) {
          throw new Error("Message should be of type Email");
        }
        expect(unwrapped.variant.subject).toBe("Hello");
        expect(unwrapped.variant.from).toBe("support@company.com");
        expect(unwrapped.variant.body).toMatch(/href="([^"]+)"/);
      });
    });
  });

  describe("sendSms", () => {
    describe("when sent from a child workspace", () => {
      let childWorkspace: Workspace;
      let parentWorkspace: Workspace;
      let template: MessageTemplate;
      let subscriptionGroup: SubscriptionGroup;

      beforeEach(async () => {
        const parentWorkspaceId = randomUUID();
        [parentWorkspace, childWorkspace] = await Promise.all([
          insert({
            table: dbWorkspace,
            values: {
              id: parentWorkspaceId,
              name: `parent-workspace-${randomUUID()}`,
              type: WorkspaceTypeAppEnum.Parent,
              updatedAt: new Date(),
              createdAt: new Date(),
            },
          }).then(unwrap),
          insert({
            table: dbWorkspace,
            values: {
              id: randomUUID(),
              parentWorkspaceId,
              name: `child-workspace-${randomUUID()}`,
              type: WorkspaceTypeAppEnum.Child,
              updatedAt: new Date(),
              createdAt: new Date(),
            },
          }).then(unwrap),
        ]);
        [template, subscriptionGroup] = await Promise.all([
          insert({
            table: dbMessageTemplate,
            values: {
              id: randomUUID(),
              workspaceId: childWorkspace.id,
              name: `template-${randomUUID()}`,
              updatedAt: new Date(),
              createdAt: new Date(),
              definition: {
                type: ChannelType.Sms,
                body: "Test SMS body",
              } satisfies SmsTemplateResource,
            },
          }).then(unwrap),
          insert({
            table: dbSubscriptionGroup,
            values: {
              id: randomUUID(),
              workspaceId: childWorkspace.id,
              name: `group-${randomUUID()}`,
              type: "OptOut",
              channel: ChannelType.Sms,
              updatedAt: new Date(),
              createdAt: new Date(),
            },
          }).then(unwrap),
          upsertSubscriptionSecret({
            workspaceId: childWorkspace.id,
          }),
          upsertSmsProvider({
            workspaceId: parentWorkspace.id,
            config: { type: SmsProviderType.Test },
          }),
        ]);
      });

      it("should use the parent workspace's SMS provider", async () => {
        const userId = "1234";
        const phone = "+1234567890";

        const payload = await sendSms({
          workspaceId: childWorkspace.id,
          templateId: template.id,
          messageTags: {
            workspaceId: childWorkspace.id,
            templateId: template.id,
            runId: "run-id-1",
            nodeId: "node-id-1",
            messageId: "message-id-1",
          } satisfies MessageTags,
          userPropertyAssignments: {
            id: userId,
            phone,
          },
          userId,
          useDraft: false,
          subscriptionGroupDetails: {
            id: subscriptionGroup.id,
            name: subscriptionGroup.name,
            type: SubscriptionGroupType.OptOut,
            action: null,
          },
          providerOverride: SmsProviderType.Test,
        });
        const unwrapped = unwrap(payload);
        expect(unwrapped.type).toBe(InternalEventType.MessageSent);
      });
    });
  });
  describe("upsertMessageTemplate", () => {
    describe("when a message template is created in a second workspace with a re-used id", () => {
      let secondWorkspace: Workspace;
      beforeEach(async () => {
        secondWorkspace = await insert({
          table: dbWorkspace,
          values: {
            id: randomUUID(),
            name: randomUUID(),
            updatedAt: new Date(),
            createdAt: new Date(),
          },
        }).then(unwrap);
      });
      it("returns a unique constraint violation error", async () => {
        const id = randomUUID();
        const result = await upsertMessageTemplate({
          id,
          name: randomUUID(),
          workspaceId: workspace.id,
          definition: {
            type: ChannelType.Email,
            from: "support@company.com",
            subject: "Hello",
            body: "{% unsubscribe_link here %}.",
          } satisfies EmailTemplateResource,
        });
        expect(result.isOk()).toBe(true);
        const secondResult = await upsertMessageTemplate({
          id,
          name: randomUUID(),
          workspaceId: secondWorkspace.id,
          definition: {
            type: ChannelType.Email,
            from: "support@company.com",
            subject: "Hello",
            body: "{% unsubscribe_link here %}.",
          } satisfies EmailTemplateResource,
        });
        const errorType = secondResult.isErr() && secondResult.error.type;
        expect(
          errorType,
          "second upsert should fail with unique constraint violation",
        ).toEqual(
          UpsertMessageTemplateValidationErrorType.UniqueConstraintViolation,
        );
      });
    });
  });
});
