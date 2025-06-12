import { randomUUID } from "crypto";
import {
  EmailProviderSecret,
  EmailProviderType,
  WorkspaceWideEmailProviderSecret,
  DefaultEmailProviderResource,
} from "isomorphic-lib/src/types";
import { Ok, Err, Result } from "neverthrow";

import * as config from "./config";
import * as crypto from "./crypto";
import { db } from "./db";
import {
  createEmailProvider,
  listEmailProviders,
  updateEmailProvider,
  deleteEmailProvider,
  setDefaultEmailProvider,
  EmailProviderListItem,
  EmailProviderConfigContents,
} from "./emailProviders"; // Assuming this is where functions will be
import { AppError } from "./types";
import { defaultEmailProvider, emailProvider, secret } from "./db/schema";

// Mock config
jest.mock("./config");
const mockConfig = config as jest.Mocked<typeof config>;

// Mock crypto
jest.mock("./crypto");
const mockEncryptSymmetric = crypto.encryptSymmetric as jest.MockedFunction<
  typeof crypto.encryptSymmetric
>;
const mockDecryptSymmetric = crypto.decryptSymmetric as jest.MockedFunction<
  typeof crypto.decryptSymmetric
>;

// Mock db
jest.mock("./db", () => ({
  ...jest.requireActual("./db"), // retain other exports if any
  db: jest.fn().mockReturnValue({
    query: {
      emailProvider: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      secret: {
        findFirst: jest.fn(),
      },
      defaultEmailProvider: {
        findFirst: jest.fn(),
      },
      // any other tables if needed by the functions
    },
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    onConflictDoUpdate: jest.fn().mockReturnThis(),
    returning: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    and: jest.fn(), // If used directly; often Drizzle handles this internally
    eq: jest.fn(), // If used directly
  }),
}));

const mockDbClient = db as jest.MockedFunction<typeof db>;
// Helper to access the mock 'returning' function from the chained DB calls
const mockDbReturning = (
  mockDbClient().insert(jest.fn()).values(jest.fn()) as any
).returning as jest.MockedFunction<any>;
const mockDbUpdateReturning = (
  mockDbClient().update(jest.fn()).set(jest.fn()).where(jest.fn()) as any
).returning as jest.MockedFunction<any>;
const mockDbDeleteReturning = (
  mockDbClient().delete(jest.fn()).where(jest.fn()) as any
).returning as jest.MockedFunction<any>;


describe("emailProviders Service", () => {
  const workspaceId = randomUUID();
  const mockEncryptionKey = "test-encryption-key";

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.default.mockReturnValue({
      secretKey: mockEncryptionKey,
    } as any);

    // Reset all specific mock implementations for db().query...
    (mockDbClient().query.emailProvider.findFirst as jest.Mock).mockReset();
    (mockDbClient().query.emailProvider.findMany as jest.Mock).mockReset();
    (mockDbClient().query.secret.findFirst as jest.Mock).mockReset();
    (mockDbClient().query.defaultEmailProvider.findFirst as jest.Mock).mockReset();
    mockDbReturning.mockReset();
    mockDbUpdateReturning.mockReset();
    mockDbDeleteReturning.mockReset();
  });

  describe("createEmailProvider", () => {
    const providerName = "Test SMTP Provider";
    const providerType = EmailProviderType.Smtp;
    const smtpConfigContents: EmailProviderConfigContents = {
      host: "smtp.example.com",
      port: "587",
      username: "user",
      password: "password",
      // other SMTP fields if necessary
    };
    const secretId = randomUUID();
    const newProviderId = randomUUID();

    beforeEach(() => {
      mockEncryptSymmetric.mockImplementation((val) => `enc-${val}`);
    });

    it("should successfully create an email provider", async () => {
      mockDbReturning
        .mockResolvedValueOnce([{ id: secretId }]) // Mock secret insertion
        .mockResolvedValueOnce([
          {
            id: newProviderId,
            workspaceId,
            name: providerName,
            type: providerType,
            secretId,
          },
        ]); // Mock emailProvider insertion

      const result = await createEmailProvider({
        workspaceId,
        name: providerName,
        type: providerType,
        config: smtpConfigContents,
      });

      expect(result.isOk()).toBe(true);
      const createdProvider = result._unsafeUnwrap();

      expect(mockEncryptSymmetric).toHaveBeenCalledWith(
        smtpConfigContents.password,
        mockEncryptionKey,
      );
      expect(mockDbClient().insert).toHaveBeenCalledTimes(2);

      // Check secret insertion
      expect(
        (mockDbClient().insert as jest.Mock).mock.calls[0][0],
      ).toBe(secret);
      const secretValues = (mockDbClient().values as jest.Mock).mock.calls[0][0];
      expect(secretValues.workspaceId).toBe(workspaceId);
      expect(secretValues.name).toContain(`email-provider-${providerType}-${providerName}`);
      expect(secretValues.configValue.type).toBe(providerType);
      expect(secretValues.configValue.host).toBe(smtpConfigContents.host);
      expect(secretValues.configValue.password).toBe(
        `enc-${smtpConfigContents.password}`,
      );

      // Check emailProvider insertion
      expect(
        (mockDbClient().insert as jest.Mock).mock.calls[1][0],
      ).toBe(emailProvider);
      const providerValues = (mockDbClient().values as jest.Mock).mock.calls[1][0];
      expect(providerValues.workspaceId).toBe(workspaceId);
      expect(providerValues.name).toBe(providerName);
      expect(providerValues.type).toBe(providerType);
      expect(providerValues.secretId).toBe(secretId);

      expect(createdProvider).toEqual({
        id: newProviderId,
        workspaceId,
        name: providerName,
        type: providerType,
      });
    });

    it("should return error if secret insertion fails", async () => {
      mockDbReturning.mockImplementationOnce(() => {
        throw new Error("DB error during secret insertion");
      });

      const result = await createEmailProvider({
        workspaceId,
        name: providerName,
        type: providerType,
        config: smtpConfigContents,
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe("storage_error");
      expect(error.message).toContain("An unexpected error occurred");
    });

    it("should return error and attempt to delete secret if emailProvider insertion fails", async () => {
      mockDbReturning
        .mockResolvedValueOnce([{ id: secretId }]) // secret insertion succeeds
        .mockImplementationOnce(() => { // emailProvider insertion fails
          throw new Error("DB error during provider insertion");
        });

      const result = await createEmailProvider({
        workspaceId,
        name: providerName,
        type: providerType,
        config: smtpConfigContents,
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe("storage_error");
      expect(error.message).toContain("An unexpected error occurred");

      // Check if secret deletion was attempted (though mock doesn't return value for it)
      expect(mockDbClient().delete).toHaveBeenCalledWith(secret);
      expect((mockDbClient().where as jest.Mock).mock.calls[0][0]).toEqual(eq(secret.id, secretId));
    });
  });

  describe("listEmailProviders", () => {
    it("should return a list of email providers", async () => {
      const mockProvidersFromDb = [
        {
          id: randomUUID(),
          workspaceId,
          name: "Provider 1",
          type: EmailProviderType.Smtp,
        },
        {
          id: randomUUID(),
          workspaceId,
          name: "Provider 2",
          type: EmailProviderType.SendGrid,
        },
        { // Simulate a provider with a null name, which should be filtered out
          id: randomUUID(),
          workspaceId,
          name: null,
          type: EmailProviderType.Test,
        }
      ];
      (mockDbClient().query.emailProvider.findMany as jest.Mock).mockResolvedValue(
        mockProvidersFromDb,
      );

      const result = await listEmailProviders({ workspaceId });

      expect(result.isOk()).toBe(true);
      const providers = result._unsafeUnwrap();
      expect(providers).toHaveLength(2); // Provider with null name should be filtered
      expect(providers[0]).toEqual(
        expect.objectContaining({
          id: mockProvidersFromDb[0].id,
          name: mockProvidersFromDb[0].name,
          type: mockProvidersFromDb[0].type,
          workspaceId,
        }),
      );
      expect(providers[1]).toEqual(
        expect.objectContaining({
          id: mockProvidersFromDb[1].id,
          name: mockProvidersFromDb[1].name,
          type: mockProvidersFromDb[1].type,
          workspaceId,
        }),
      );
      expect(
        mockDbClient().query.emailProvider.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: eq(emailProvider.workspaceId, workspaceId),
        }),
      );
    });

    it("should return an empty list if no providers are found", async () => {
      (mockDbClient().query.emailProvider.findMany as jest.Mock).mockResolvedValue(
        [],
      );
      const result = await listEmailProviders({ workspaceId });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual([]);
    });

    it("should return an error if DB query fails", async () => {
      (mockDbClient().query.emailProvider.findMany as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );
      const result = await listEmailProviders({ workspaceId });
      expect(result.isErr()).toBe(true);
      const err = result._unsafeUnwrapErr();
      expect(err.code).toBe("storage_error");
    });
  });

  describe("updateEmailProvider", () => {
    const providerId = randomUUID();
    const existingSecretId = randomUUID();
    const existingProviderName = "Original Name";
    const existingProviderType = EmailProviderType.Smtp;
    const existingSmtpConfig: EmailProviderSecret = {
      type: EmailProviderType.Smtp,
      name: existingProviderName, // name within secret
      host: "smtp.original.com",
      port: "587",
      username: "original_user",
      password: "enc-original_password", // Assume it's stored encrypted
    };

    beforeEach(() => {
      mockEncryptSymmetric.mockImplementation((val) => `enc-${val}`);
      // mockDecryptSymmetric.mockImplementation((val) => val.replace("enc-", ""));

      // Default mock for findFirst to return an existing provider
      (mockDbClient().query.emailProvider.findFirst as jest.Mock).mockImplementation(async ({where}) => {
        // Simulate finding the provider by id and workspaceId
        const conditions = (where as any).args[0].map((arg: any) => arg.value);
        if(conditions.includes(providerId) && conditions.includes(workspaceId)) {
          return {
            id: providerId,
            workspaceId,
            name: existingProviderName,
            type: existingProviderType,
            secretId: existingSecretId,
            secret: {
              id: existingSecretId,
              workspaceId,
              name: `email-provider-${existingProviderType}-${existingProviderName}`,
              configValue: existingSmtpConfig,
              createdAt: new Date(),
              updatedAt: new Date(),
              value: null,
            },
          };
        }
        return null;
      });
      mockDbUpdateReturning.mockResolvedValueOnce([{
        id: providerId,
        workspaceId,
        name: existingProviderName, // will be updated if name changes
        type: existingProviderType,
      }]);
    });

    it("should update only the provider name", async () => {
      const newName = "Updated Provider Name";
      (mockDbClient().update(emailProvider).set({name: newName}).where(expect.anything()) as any).returning = jest.fn().mockResolvedValueOnce([{
        id: providerId, workspaceId, name: newName, type: existingProviderType,
      }]);


      const result = await updateEmailProvider({
        providerId,
        workspaceId,
        name: newName,
      });

      expect(result.isOk()).toBe(true);
      const updatedProvider = result._unsafeUnwrap();
      expect(updatedProvider.name).toBe(newName);
      expect(updatedProvider.type).toBe(existingProviderType);
      expect(mockDbClient().update).toHaveBeenCalledWith(emailProvider);
      expect(mockDbClient().set).toHaveBeenCalledWith({ name: newName });
      expect(mockDbClient().update).not.toHaveBeenCalledWith(secret); // Secret should not be updated
    });

    it("should update only the provider config (SMTP example)", async () => {
      const newSmtpConfigContents: EmailProviderConfigContents = {
        host: "smtp.new.com",
        port: "25",
        username: "new_user",
        password: "new_password", // cleartext
      };
      // Mock findFirst to return the specific provider for the re-fetch after update
      (mockDbClient().query.emailProvider.findFirst as jest.Mock).mockResolvedValueOnce({
         id: providerId, workspaceId, name: existingProviderName, type: existingProviderType, secretId: existingSecretId,
         secret: { id: existingSecretId, workspaceId, name: "secret-name", configValue: existingSmtpConfig, createdAt: new Date(), updatedAt: new Date(), value: null},
      }).mockResolvedValueOnce({ // for re-fetch
         id: providerId, workspaceId, name: existingProviderName, type: existingProviderType
      });


      const result = await updateEmailProvider({
        providerId,
        workspaceId,
        config: newSmtpConfigContents,
      });

      expect(result.isOk()).toBe(true);
      expect(mockEncryptSymmetric).toHaveBeenCalledWith("new_password", mockEncryptionKey);
      expect(mockDbClient().update).toHaveBeenCalledWith(secret);
      const updatedSecretConfig = (mockDbClient().set as jest.Mock).mock.calls[0][0].configValue;
      expect(updatedSecretConfig.host).toBe("smtp.new.com");
      expect(updatedSecretConfig.password).toBe("enc-new_password");
      expect(updatedSecretConfig.type).toBe(EmailProviderType.Smtp); // Type should be preserved
    });

    it("should return not_found if provider does not exist", async () => {
      (mockDbClient().query.emailProvider.findFirst as jest.Mock).mockResolvedValueOnce(null);
      const result = await updateEmailProvider({
        providerId: "non-existent-id",
        workspaceId,
        name: "New Name",
      });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("not_found");
    });
  });

  describe("deleteEmailProvider", () => {
    const providerIdToDelete = randomUUID();
    const secretIdToDelete = randomUUID();

    it("should successfully delete an email provider and its secret", async () => {
      (mockDbClient().query.emailProvider.findFirst as jest.Mock).mockResolvedValueOnce({
        id: providerIdToDelete,
        secretId: secretIdToDelete,
      });
      mockDbDeleteReturning.mockResolvedValueOnce([{ id: providerIdToDelete }]); // Mock emailProvider deletion
      // Mock secret deletion (doesn't need to return anything specific for this test)
      (mockDbClient().delete(secret).where(expect.anything()) as any).returning = jest.fn().mockResolvedValueOnce([{}]);


      const result = await deleteEmailProvider({
        providerId: providerIdToDelete,
        workspaceId,
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeUndefined();

      // Verify defaultEmailProvider deletion was attempted
      expect(mockDbClient().delete).toHaveBeenCalledWith(defaultEmailProvider);
      expect((mockDbClient().where as jest.Mock).mock.calls[0][0]).toEqual(
        and(
          eq(defaultEmailProvider.workspaceId, workspaceId),
          eq(defaultEmailProvider.emailProviderId, providerIdToDelete),
        )
      );

      // Verify emailProvider deletion
      expect(mockDbClient().delete).toHaveBeenCalledWith(emailProvider);
      expect((mockDbClient().where as jest.Mock).mock.calls[1][0]).toEqual(
         and(
          eq(emailProvider.id, providerIdToDelete),
          eq(emailProvider.workspaceId, workspaceId),
        )
      );

      // Verify secret deletion
      expect(mockDbClient().delete).toHaveBeenCalledWith(secret);
       expect((mockDbClient().where as jest.Mock).mock.calls[2][0]).toEqual(
        eq(secret.id, secretIdToDelete)
      );
    });

    it("should return not_found if provider does not exist", async () => {
      (mockDbClient().query.emailProvider.findFirst as jest.Mock).mockResolvedValueOnce(null);
      const result = await deleteEmailProvider({
        providerId: "non-existent-id",
        workspaceId,
      });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("not_found");
    });

    it("should proceed with deletion even if provider has no secretId", async () => {
      (mockDbClient().query.emailProvider.findFirst as jest.Mock).mockResolvedValueOnce({
        id: providerIdToDelete,
        secretId: null, // No secret associated
      });
      mockDbDeleteReturning.mockResolvedValueOnce([{ id: providerIdToDelete }]);


      const result = await deleteEmailProvider({
        providerId: providerIdToDelete,
        workspaceId,
      });

      expect(result.isOk()).toBe(true);
      // Check that delete on 'secret' table was not called, or called with undefined/null which is fine
      const deleteCalls = (mockDbClient().delete as jest.Mock).mock.calls;
      const secretDeleteCall = deleteCalls.find(callArgs => callArgs[0] === secret);
      expect(secretDeleteCall).toBeUndefined();
    });
  });

  describe("setDefaultEmailProvider", () => {
    const providerToSetAsDefaultId = randomUUID();

    it("should successfully set a provider as default", async () => {
      // Mock provider existence check
      (mockDbClient().query.emailProvider.findFirst as jest.Mock).mockResolvedValueOnce({
        id: providerToSetAsDefaultId,
        workspaceId,
      });
      // Mock upsert returning the new default record
      mockDbReturning.mockResolvedValueOnce([
        {
          workspaceId,
          emailProviderId: providerToSetAsDefaultId,
          fromAddress: null, // Assuming fromAddress is handled separately or defaults to null here
        },
      ]);

      const result = await setDefaultEmailProvider({
        workspaceId,
        providerId: providerToSetAsDefaultId,
      });

      expect(result.isOk()).toBe(true);
      const defaultProvider = result._unsafeUnwrap();
      expect(defaultProvider.workspaceId).toBe(workspaceId);
      expect(defaultProvider.emailProviderId).toBe(providerToSetAsDefaultId);
      expect(defaultProvider.fromAddress).toBeNull(); // Based on current mock

      expect(mockDbClient().insert).toHaveBeenCalledWith(defaultEmailProvider);
      const insertValues = (mockDbClient().values as jest.Mock).mock.calls[0][0];
      expect(insertValues.workspaceId).toBe(workspaceId);
      expect(insertValues.emailProviderId).toBe(providerToSetAsDefaultId);
      expect(mockDbClient().onConflictDoUpdate).toHaveBeenCalled();
    });

    it("should return not_found if the provider to set as default does not exist", async () => {
      (mockDbClient().query.emailProvider.findFirst as jest.Mock).mockResolvedValueOnce(null);

      const result = await setDefaultEmailProvider({
        workspaceId,
        providerId: "non-existent-provider-id",
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe("not_found");
      expect(error.message).toContain("not found in workspace");
    });

    it("should return storage_error if upsert fails", async () => {
      (mockDbClient().query.emailProvider.findFirst as jest.Mock).mockResolvedValueOnce({
        id: providerToSetAsDefaultId,
        workspaceId,
      });
      mockDbReturning.mockImplementationOnce(() => {
        throw new Error("DB upsert error");
      });

      const result = await setDefaultEmailProvider({
        workspaceId,
        providerId: providerToSetAsDefaultId,
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe("storage_error");
    });
  });
});

/*
Conceptual Structure for API Tests (e.g., packages/api/src/controllers/settingsController.test.ts):

jest.mock("backend-lib/src/emailProviders", () => ({
  createEmailProvider: jest.fn(),
  listEmailProviders: jest.fn(),
  updateEmailProvider: jest.fn(),
  deleteEmailProvider: jest.fn(),
  setDefaultEmailProvider: jest.fn(),
}));

describe("settingsController - Email Providers API", () => {
  let app: FastifyInstance; // Assuming Fastify app instance setup

  beforeEach(() => {
    // Reset service mocks
    jest.clearAllMocks();
  });

  describe("POST /api/settings/email-providers", () => {
    it("should return 201 and the created provider on success", async () => {
      const mockProvider = { id: "1", name: "test", type: EmailProviderType.Test, workspaceId };
      (createEmailProvider as jest.Mock).mockResolvedValue(ok(mockProvider));
      const response = await app.inject({
        method: "POST",
        url: "/api/settings/email-providers",
        payload: { workspaceId, name: "test", type: EmailProviderType.Test, config: {} },
      });
      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.payload)).toEqual(mockProvider);
    });

    it("should return 400 if request body is invalid", async () => {
       const response = await app.inject({
        method: "POST",
        url: "/api/settings/email-providers",
        payload: { workspaceId }, // Missing name, type, config
      });
      expect(response.statusCode).toBe(400);
    });

    it("should return 500 if service fails", async () => {
      (createEmailProvider as jest.Mock).mockResolvedValue(err(new AppError("storage_error", "DB error")));
      const response = await app.inject({
        method: "POST",
        url: "/api/settings/email-providers",
        payload: { workspaceId, name: "test", type: EmailProviderType.Test, config: {} },
      });
      expect(response.statusCode).toBe(500); // Or whatever error handling middleware does
    });
  });

  describe("GET /api/settings/email-providers", () => {
    it("should return 200 and a list of providers", async () => {
      const mockProviders = [{ id: "1", name: "test", type: EmailProviderType.Test, workspaceId }];
      (listEmailProviders as jest.Mock).mockResolvedValue(ok(mockProviders));
      const response = await app.inject({
        method: "GET",
        url: `/api/settings/email-providers?workspaceId=${workspaceId}`,
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ data: mockProviders });
    });
    // Add test for missing workspaceId (should be caught by schema validation)
  });

  describe("PUT /api/settings/email-providers/:providerId", () => {
    const providerId = "provider-1";
    it("should return 200 and the updated provider on success", async () => {
      const mockProvider = { id: providerId, name: "updated", type: EmailProviderType.Test, workspaceId };
      (updateEmailProvider as jest.Mock).mockResolvedValue(ok(mockProvider));
      const response = await app.inject({
        method: "PUT",
        url: `/api/settings/email-providers/${providerId}`,
        payload: { name: "updated" },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual(mockProvider);
    });
    // Add tests for invalid body, provider not found (404), service error (500)
  });

  describe("DELETE /api/settings/email-providers/:providerId", () => {
    const providerId = "provider-1";
    it("should return 200 (or 204) on successful deletion", async () => {
      (deleteEmailProvider as jest.Mock).mockResolvedValue(ok(undefined));
      const response = await app.inject({
        method: "DELETE",
        url: `/api/settings/email-providers/${providerId}?workspaceId=${workspaceId}`,
      });
      expect([200, 204]).toContain(response.statusCode);
    });
    // Add tests for provider not found (404), service error (500)
  });

  describe("PUT /api/settings/email-providers/default-provider/set", () => {
    it("should return 200 and the default provider resource on success", async () => {
      const mockDefaultResource = { workspaceId, emailProviderId: "provider-1", fromAddress: null };
      (setDefaultEmailProvider as jest.Mock).mockResolvedValue(ok(mockDefaultResource));
      const response = await app.inject({
        method: "PUT",
        url: "/api/settings/email-providers/default-provider/set",
        payload: { workspaceId, providerId: "provider-1" },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual(mockDefaultResource);
    });
    // Add tests for invalid body, provider not found (404), service error (500)
  });
});
*/
