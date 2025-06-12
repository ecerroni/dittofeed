/* eslint-disable arrow-body-style */
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { getOrCreateWriteKey, getWriteKeys } from "backend-lib/src/auth";
import { db, upsert } from "backend-lib/src/db";
import * as schema from "backend-lib/src/db/schema";
import { upsertEmailProvider } from "backend-lib/src/messaging/email";
import { upsertSmsProvider } from "backend-lib/src/messaging/sms";
import { and, eq } from "drizzle-orm";
import { FastifyInstance } from "fastify";
import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";
import {
  BadRequestResponse,
  DataSourceConfigurationResource,
  DataSourceVariantType,
  DefaultEmailProviderResource,
  DefaultSmsProviderResource,
  DeleteDataSourceConfigurationRequest,
  DeleteWriteKeyResource,
  EmptyResponse,
  ListDataSourceConfigurationRequest,
  ListDataSourceConfigurationResponse,
  ListWriteKeyRequest,
  ListWriteKeyResource,
  PersistedSmsProvider,
  UpsertDataSourceConfigurationResource,
  UpsertDefaultEmailProviderRequest,
  UpsertEmailProviderRequest,
  UpsertSmsProviderRequest,
  UpsertWriteKeyResource,
  WriteKeyResource,
  EmailProviderType as IsomorphicEmailProviderType, // Alias to avoid conflict if re-declared
  // Assuming WorkspaceWideEmailProviderSecret might be useful, or a simplified version of it
  // For now, let's define a generic config object for requests.
  // Actual validation against specific provider types would happen in the service layer.
} from "isomorphic-lib/src/types";

// Placeholder Schemas for new Email Provider CRUD
// Generic config for request bodies, actual validation against specific provider types in service
const EmailProviderConfigValueSchema = Type.Record(Type.String(), Type.Any(), {
  description:
    "Configuration object for the email provider. Structure depends on the provider type.",
});

const CreateEmailProviderBodySchema = Type.Object({
  workspaceId: Type.String(),
  name: Type.String({
    description: "A user-friendly name for the email provider instance.",
  }),
  type: Type.Enum(IsomorphicEmailProviderType, {
    description: "The type of email provider (e.g., SendGrid, AmazonSes).",
  }),
  config: EmailProviderConfigValueSchema,
});
type CreateEmailProviderBody = Static<typeof CreateEmailProviderBodySchema>;

const EmailProviderListItemSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  name: Type.String(),
  type: Type.Enum(IsomorphicEmailProviderType),
  // Config is generally not returned in list views or only non-sensitive parts
});
type EmailProviderListItem = Static<typeof EmailProviderListItemSchema>;

const ListEmailProvidersResponseSchema = Type.Object({
  data: Type.Array(EmailProviderListItemSchema),
});

const ProviderIdParamsSchema = Type.Object({
  providerId: Type.String(),
});
type ProviderIdParams = Static<typeof ProviderIdParamsSchema>;

const WorkspaceIdQuerySchema = Type.Object({
  workspaceId: Type.String(),
});

const UpdateEmailProviderBodySchema = Type.Partial(
  Type.Pick(CreateEmailProviderBodySchema, ["name", "config"]),
);
type UpdateEmailProviderBody = Static<typeof UpdateEmailProviderBodySchema>;

// For setting default by provider ID
const SetDefaultEmailProviderBodySchema = Type.Object({
  workspaceId: Type.String(),
  providerId: Type.String(),
});
type SetDefaultEmailProviderBody = Static<
  typeof SetDefaultEmailProviderBodySchema
>;

// Placeholder service - actual implementation would be in backend-lib
const emailProvidersService = {
  create: async (data: CreateEmailProviderBody) => {
    // Mock implementation
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return { ...data, id: "new-provider-id" } as any;
  },
  list: async ({ workspaceId }: { workspaceId: string }) => {
    // Mock implementation
    return [{
      id: "provider-id-1",
      workspaceId,
      name: "Test Provider 1",
      type: IsomorphicEmailProviderType.Test,
    }] as EmailProviderListItem[];
  },
  update: async (
    data: UpdateEmailProviderBody & { providerId: string; workspaceId: string },
  ) => {
    return {
      id: data.providerId,
      workspaceId: data.workspaceId,
      name: data.name ?? "Updated Name",
      type: IsomorphicEmailProviderType.Test, // Example type
      // config should be handled carefully
    } as EmailProviderListItem;
  },
  delete: async ({
    providerId,
    workspaceId,
  }: {
    providerId: string;
    workspaceId: string;
  }) => {
    // Mock implementation
    return { success: true };
  },
  setDefault: async (data: SetDefaultEmailProviderBody) => {
    // Mock implementation
    return {
      workspaceId: data.workspaceId,
      emailProviderId: data.providerId,
      fromAddress: "test@example.com", // Example
    } as DefaultEmailProviderResource;
  },
};

// eslint-disable-next-line @typescript-eslint/require-await
export default async function settingsController(fastify: FastifyInstance) {
  // BEGIN: New Email Provider CRUD routes
  fastify.withTypeProvider<TypeBoxTypeProvider>().post(
    "/email-providers",
    {
      schema: {
        description: "Create a new email provider configuration.",
        tags: ["Email Providers"],
        body: CreateEmailProviderBodySchema,
        response: {
          201: EmailProviderListItemSchema,
          400: BadRequestResponse,
          // TODO: Add other error responses e.g. 500
        },
      },
    },
    async (request, reply) => {
      const data = request.body;
      // In a real scenario, workspaceId might come from auth context
      // For now, it's part of the body as per schema.

      // TODO: Add proper error handling for service call
      const result = await emailProvidersService.create(data);
      // Assuming service returns the created object matching EmailProviderListItemSchema
      // or throws an error that gets caught by Fastify's error handler.
      return reply.status(201).send(result);
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    "/email-providers",
    {
      schema: {
        description: "List email provider configurations for a workspace.",
        tags: ["Email Providers"],
        querystring: WorkspaceIdQuerySchema, // Requires workspaceId
        response: {
          200: ListEmailProvidersResponseSchema,
          // TODO: Add error responses
        },
      },
    },
    async (request, reply) => {
      // TODO: Add proper error handling for service call
      const result = await emailProvidersService.list({
        workspaceId: request.query.workspaceId,
      });
      return reply.status(200).send({ data: result });
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().put(
    "/email-providers/:providerId",
    {
      schema: {
        description: "Update an email provider configuration.",
        tags: ["Email Providers"],
        params: ProviderIdParamsSchema,
        body: UpdateEmailProviderBodySchema,
        response: {
          200: EmailProviderListItemSchema,
          400: BadRequestResponse,
          404: Type.Object({ message: Type.String() }), // For not found
          // TODO: Add other error responses
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      const data = request.body;
      // Assuming workspaceId needs to be passed or derived for the service update method
      // For now, it's not in UpdateEmailProviderBodySchema, so would need to be passed
      // separately if the service requires it for namespacing / authz.
      // This is a placeholder; actual implementation might need workspaceId from auth.
      const placeholderWorkspaceId = "placeholder-workspace-id";

      // TODO: Add proper error handling for service call
      const result = await emailProvidersService.update({
        providerId,
        workspaceId: placeholderWorkspaceId, // Placeholder
        ...data,
      });
      // Assuming service returns the updated object or throws if not found / error
      return reply.status(200).send(result);
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().delete(
    "/email-providers/:providerId",
    {
      schema: {
        description: "Delete an email provider configuration.",
        tags: ["Email Providers"],
        params: ProviderIdParamsSchema,
        // workspaceId might be part of auth or a query param for namespacing
        querystring: WorkspaceIdQuerySchema,
        response: {
          200: Type.Object({ success: Type.Boolean() }), // Or 204 No Content
          404: Type.Object({ message: Type.String() }),
          // TODO: Add other error responses
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      const { workspaceId } = request.query; // Assuming workspaceId from query for now

      // TODO: Add proper error handling for service call
      const result = await emailProvidersService.delete({
        providerId,
        workspaceId,
      });
      // Assuming service returns { success: true } or throws if not found / error
      if (result.success) {
        return reply.status(200).send({ success: true });
      }
      // This path might not be reached if service throws on failure
      return reply.status(500).send({ success: false });
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().put(
    "/email-providers/default-provider/set", // New distinct path
    {
      schema: {
        description: "Set an email provider as the default for the workspace.",
        tags: ["Email Providers"],
        body: SetDefaultEmailProviderBodySchema,
        response: {
          200: DefaultEmailProviderResource, // Assuming this is the correct response type
          400: BadRequestResponse,
          404: Type.Object({ message: Type.String() }),
          // TODO: Add other error responses
        },
      },
    },
    async (request, reply) => {
      const data = request.body;
      // TODO: Add proper error handling for service call
      const result = await emailProvidersService.setDefault(data);
      // Assuming service returns the default provider resource or throws
      return reply.status(200).send(result);
    },
  );
  // END: New Email Provider CRUD routes

  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    "/data-sources",
    {
      schema: {
        description: "Get data source settings",
        tags: ["Settings"],
        querystring: ListDataSourceConfigurationRequest,
        response: {
          200: ListDataSourceConfigurationResponse,
        },
      },
    },
    async (request, reply) => {
      const segmentIoConfiguration =
        await db().query.segmentIoConfiguration.findFirst({
          where: eq(
            schema.segmentIoConfiguration.workspaceId,
            request.query.workspaceId,
          ),
        });
      const existingDatasources: DataSourceVariantType[] = [];
      if (segmentIoConfiguration) {
        existingDatasources.push(DataSourceVariantType.SegmentIO);
      }
      return reply.status(200).send({
        dataSourceConfigurations: existingDatasources,
      });
    },
  );
  fastify.withTypeProvider<TypeBoxTypeProvider>().put(
    "/data-sources",
    {
      schema: {
        description: "Create or update data source settings",
        tags: ["Settings"],
        body: UpsertDataSourceConfigurationResource,
        response: {
          200: DataSourceConfigurationResource,
          400: Type.Object({
            error: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, variant } = request.body;

      let resource: DataSourceConfigurationResource;
      switch (variant.type) {
        case DataSourceVariantType.SegmentIO: {
          if (!variant.sharedSecret) {
            return reply.status(400).send({
              error:
                "Invalid payload. Segment variant musti included sharedSecret value.",
            });
          }
          const { id } = await upsert({
            table: schema.segmentIoConfiguration,
            values: {
              workspaceId,
              sharedSecret: variant.sharedSecret,
            },
            target: [schema.segmentIoConfiguration.workspaceId],
            set: {
              sharedSecret: variant.sharedSecret,
            },
          }).then(unwrap);

          resource = {
            id,
            workspaceId,
            variant: {
              type: variant.type,
              sharedSecret: variant.sharedSecret,
            },
          };
        }
      }

      return reply.status(200).send(resource);
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().delete(
    "/data-sources",
    {
      schema: {
        description: "Delete data source settings",
        tags: ["Settings"],
        querystring: DeleteDataSourceConfigurationRequest,
        response: {
          204: EmptyResponse,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, type } = request.query;
      switch (type) {
        case DataSourceVariantType.SegmentIO: {
          await db()
            .delete(schema.segmentIoConfiguration)
            .where(eq(schema.segmentIoConfiguration.workspaceId, workspaceId));
          break;
        }
      }
      return reply.status(204).send();
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().put(
    "/sms-providers/default",
    {
      schema: {
        description: "Create or update default email provider settings",
        tags: ["Settings"],
        body: DefaultSmsProviderResource,
        response: {
          200: PersistedSmsProvider,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, smsProviderId } = request.body;

      await upsert({
        table: schema.defaultSmsProvider,
        values: {
          workspaceId,
          smsProviderId,
        },
        target: [schema.defaultSmsProvider.workspaceId],
        set: {
          smsProviderId,
        },
      });

      return reply.status(201).send();
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().put(
    "/email-providers",
    {
      schema: {
        description: "Create or update email provider",
        tags: ["Settings"],
        body: UpsertEmailProviderRequest,
        response: {
          201: EmptyResponse,
          400: BadRequestResponse,
        },
      },
    },
    async (request, reply) => {
      await upsertEmailProvider(request.body);
      return reply.status(201).send();
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().put(
    "/sms-providers",
    {
      schema: {
        description: "Create or update sms provider",
        tags: ["Settings"],
        body: UpsertSmsProviderRequest,
        response: {
          201: EmptyResponse,
          400: BadRequestResponse,
        },
      },
    },
    async (request, reply) => {
      await upsertSmsProvider(request.body);
      return reply.status(201).send();
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().put(
    "/email-providers/default",
    {
      schema: {
        description: "Create or update email provider default",
        tags: ["Settings"],
        body: UpsertDefaultEmailProviderRequest,
        response: {
          201: EmptyResponse,
          400: BadRequestResponse,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, fromAddress } = request.body;
      let resource: DefaultEmailProviderResource;
      if ("emailProviderId" in request.body) {
        resource = request.body;
      } else {
        const emailProvider = await db().query.emailProvider.findFirst({
          where: and(
            eq(schema.emailProvider.workspaceId, workspaceId),
            eq(schema.emailProvider.type, request.body.emailProvider),
          ),
        });
        if (!emailProvider) {
          return reply.status(400).send({
            message: "Invalid payload. Email provider not found.",
          });
        }
        resource = {
          workspaceId,
          emailProviderId: emailProvider.id,
          fromAddress,
        };
      }

      await upsert({
        table: schema.defaultEmailProvider,
        values: resource,
        target: [schema.defaultEmailProvider.workspaceId],
        set: resource,
      });

      return reply.status(201).send();
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().put(
    "/write-keys",
    {
      schema: {
        description: "Create a write key.",
        tags: ["Settings"],
        body: UpsertWriteKeyResource,
        response: {
          200: WriteKeyResource,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, writeKeyName } = request.body;

      await getOrCreateWriteKey({
        workspaceId,
        writeKeyName,
      });
      return reply.status(204).send();
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    "/write-keys",
    {
      schema: {
        description: "Get write keys.",
        tags: ["Settings"],
        querystring: ListWriteKeyRequest,
        response: {
          200: ListWriteKeyResource,
        },
      },
    },
    async (request, reply) => {
      const resource = await getWriteKeys({
        workspaceId: request.query.workspaceId,
      });
      return reply.status(200).send(resource);
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().delete(
    "/write-keys",
    {
      schema: {
        description: "Delete a write key.",
        tags: ["Settings"],
        body: DeleteWriteKeyResource,
        response: {
          204: EmptyResponse,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, writeKeyName } = request.body;
      const result = await db()
        .delete(schema.secret)
        .where(
          and(
            eq(schema.secret.workspaceId, workspaceId),
            eq(schema.secret.name, writeKeyName),
          ),
        )
        .returning();
      if (!result.length) {
        return reply.status(404).send();
      }
      return reply.status(204).send();
    },
  );
}
