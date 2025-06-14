import {
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import axios from "axios";
import {
  // Relevant types from isomorphic-lib will be used or defined locally
  WorkspaceId,
  EmailProviderType, // Assuming this enum is available from previous steps
  DefaultEmailProviderResource as IsomorphicDefaultEmailProviderResource,
  // Add other necessary imports from isomorphic-lib like UpsertUserPropertyResource, UserPropertyResource etc.
  // For now, keeping it minimal to what's directly used by the new functions.
} from "isomorphic-lib/src/types";

// Base API client setup
const apiClient = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// TODO: Move these specific request/response types to isomorphic-lib if they become canonical.
// For now, defining simplified versions here.

export interface EmailProviderConfigContents {
  // This would be a union of specific provider configs, e.g., SmtpConfig, SendgridConfig
  // For now, using a generic record.
  [key: string]: any;
}

export interface CreateEmailProviderRequest {
  workspaceId: WorkspaceId;
  name: string;
  type: EmailProviderType;
  config: EmailProviderConfigContents;
}

export interface EmailProviderListItem {
  id: string;
  workspaceId: WorkspaceId;
  name: string;
  type: EmailProviderType;
  // Config is generally not returned in list views, or only non-sensitive parts
}

export interface ListEmailProvidersResponse {
  data: EmailProviderListItem[];
}

export interface UpdateEmailProviderRequest {
  // providerId is part of the URL path
  workspaceId: WorkspaceId; // Usually for auth/namespacing on backend, passed in body by convention here
  name?: string;
  config?: EmailProviderConfigContents;
}

export interface SetDefaultEmailProviderRequest {
  workspaceId: WorkspaceId;
  providerId: string;
}

// Re-exporting existing isomorphic types if they are suitable, or using locally defined ones.
export type DefaultEmailProviderResource = IsomorphicDefaultEmailProviderResource;

// API Client Functions for Email Providers

export async function fetchEmailProviders(
  workspaceId: WorkspaceId,
): Promise<EmailProviderListItem[]> {
  if (!workspaceId) {
    // Or throw, or return err(new Error("Workspace ID is required"));
    // Depending on how hook handles disabled state, this might not be strictly needed.
    return [];
  }
  const response = await apiClient.get<ListEmailProvidersResponse>(
    `/settings/email-providers?workspaceId=${workspaceId}`,
  );
  return response.data.data;
}

export async function createEmailProvider(
  data: CreateEmailProviderRequest,
): Promise<EmailProviderListItem> {
  const response = await apiClient.post<EmailProviderListItem>(
    "/settings/email-providers",
    data,
  );
  return response.data;
}

export async function updateEmailProvider({
  providerId,
  ...data
}: UpdateEmailProviderRequest & { providerId: string }): Promise<EmailProviderListItem> {
  const response = await apiClient.put<EmailProviderListItem>(
    `/settings/email-providers/${providerId}`,
    data, // data includes workspaceId, name (optional), config (optional)
  );
  return response.data;
}

export async function deleteEmailProvider({
  workspaceId,
  providerId,
}: {
  workspaceId: WorkspaceId;
  providerId: string;
}): Promise<void> {
  await apiClient.delete(
    `/settings/email-providers/${providerId}?workspaceId=${workspaceId}`,
  );
}

export async function setDefaultEmailProvider(
  data: SetDefaultEmailProviderRequest,
): Promise<DefaultEmailProviderResource> {
  const response = await apiClient.put<DefaultEmailProviderResource>(
    "/settings/email-providers/default-provider/set",
    data,
  );
  return response.data;
}

export async function fetchDefaultEmailProvider(
  workspaceId: WorkspaceId,
): Promise<DefaultEmailProviderResource | null> {
  if (!workspaceId) {
    return null;
  }
  try {
    const response = await apiClient.get<DefaultEmailProviderResource>(
      // This endpoint path needs to exist on the backend.
      // The existing PUT /api/settings/email-providers/default is for setting by type.
      // A new GET /api/settings/email-providers/default-provider or similar might be needed.
      // For now, assuming an endpoint like this:
      `/settings/email-providers/default-provider?workspaceId=${workspaceId}`,
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    // Rethrow other errors to be caught by React Query
    throw error;
  }
}

// React Query Hooks for Email Providers

const emailProvidersQueryKeys = {
  all: (workspaceId: WorkspaceId | undefined) => ["emailProviders", workspaceId] as const,
  list: (workspaceId: WorkspaceId | undefined) => [...emailProvidersQueryKeys.all(workspaceId), "list"] as const,
  detail: (id: string | undefined) => [...emailProvidersQueryKeys.all(undefined), "detail", id] as const, // Not used yet
  default: (workspaceId: WorkspaceId | undefined) => [...emailProvidersQueryKeys.all(workspaceId), "default"] as const,
};


export function useFetchEmailProviders(
  workspaceId: WorkspaceId | undefined,
  options?: Omit<UseQueryOptions<EmailProviderListItem[], Error, EmailProviderListItem[], ReadonlyArray<unknown>>, 'queryKey' | 'queryFn' | 'enabled'>,
) {
  return useQuery<EmailProviderListItem[], Error, EmailProviderListItem[], ReadonlyArray<unknown>>(
    emailProvidersQueryKeys.list(workspaceId),
    () => {
      if (!workspaceId) {
        return Promise.resolve([]);
      }
      return fetchEmailProviders(workspaceId);
    },
    {
      enabled: !!workspaceId,
      ...options,
    },
  );
}

export function useCreateEmailProvider(
  options?: UseMutationOptions<
    EmailProviderListItem,
    Error,
    CreateEmailProviderRequest
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<
    EmailProviderListItem,
    Error,
    CreateEmailProviderRequest
  >(createEmailProvider, {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries(emailProvidersQueryKeys.list(variables.workspaceId));
      options?.onSuccess?.(data, variables, context);
    },
  });
}

export function useUpdateEmailProvider(
  options?: UseMutationOptions<
    EmailProviderListItem,
    Error,
    UpdateEmailProviderRequest & { providerId: string }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<
    EmailProviderListItem,
    Error,
    UpdateEmailProviderRequest & { providerId: string }
  >(updateEmailProvider, {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries(emailProvidersQueryKeys.list(variables.workspaceId));
      // Optionally, update the specific item in the cache if desired
      // queryClient.setQueryData(emailProvidersQueryKeys.detail(variables.providerId), data);
      options?.onSuccess?.(data, variables, context);
    },
  });
}

export function useDeleteEmailProvider(
  options?: UseMutationOptions<
    void,
    Error,
    { workspaceId: WorkspaceId; providerId: string }
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { workspaceId: WorkspaceId; providerId: string }
  >(deleteEmailProvider, {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries(emailProvidersQueryKeys.list(variables.workspaceId));
      queryClient.invalidateQueries(emailProvidersQueryKeys.default(variables.workspaceId)); // Default might change
      options?.onSuccess?.(data, variables, context);
    },
  });
}

export function useSetDefaultEmailProvider(
  options?: UseMutationOptions<
    DefaultEmailProviderResource,
    Error,
    SetDefaultEmailProviderRequest
  >,
) {
  const queryClient = useQueryClient();
  return useMutation<
    DefaultEmailProviderResource,
    Error,
    SetDefaultEmailProviderRequest
  >(setDefaultEmailProvider, {
    ...options,
    onSuccess: (data, variables, context) => {
      // Invalidate list as default status might be shown there (though not in current EmailProviderListItem)
      queryClient.invalidateQueries(emailProvidersQueryKeys.list(variables.workspaceId));
      queryClient.invalidateQueries(emailProvidersQueryKeys.default(variables.workspaceId));
      options?.onSuccess?.(data, variables, context);
    },
  });
}

export function useFetchDefaultEmailProvider(
  workspaceId: WorkspaceId | undefined,
  options?: Omit<UseQueryOptions<DefaultEmailProviderResource | null, Error, DefaultEmailProviderResource | null, ReadonlyArray<unknown>>, 'queryKey' | 'queryFn' | 'enabled'>,
) {
  return useQuery<DefaultEmailProviderResource | null, Error, DefaultEmailProviderResource | null, ReadonlyArray<unknown>>(
    emailProvidersQueryKeys.default(workspaceId),
    () => {
      if (!workspaceId) {
        return Promise.resolve(null);
      }
      return fetchDefaultEmailProvider(workspaceId);
    },
    {
      enabled: !!workspaceId,
      ...options,
    },
  );
}

// ========= TODO: Move to isomorphic-lib/src/types.ts or a dedicated API types file =========
// Simplified example, actual types would be more specific
export interface SendgridConfigForRequestPayload {
  apiKey: string;
  // other sendgrid specific fields
}

export interface SMTPConfigForRequestPayload {
  host: string;
  port: string;
  username?: string;
  password?: string;
  // other smtp specific fields
}

// Example of how EmailProviderConfigContents might be structured more concretely
export type ConcreteEmailProviderConfigContents =
  | ({ type: EmailProviderType.SendGrid } & SendgridConfigForRequestPayload)
  | ({ type: EmailProviderType.Smtp } & SMTPConfigForRequestPayload)
  | ({ type: EmailProviderType.AmazonSes; accessKeyId: string; secretAccessKey: string; region: string })
  | ({ type: EmailProviderType.Resend; apiKey: string; })
  | ({ type: EmailProviderType.PostMark; apiKey: string; })
  | ({ type: EmailProviderType.MailChimp; apiKey: string; })
  | ({ type: EmailProviderType.Test }); // Test might have no specific config fields

// CreateEmailProviderRequest could then use ConcreteEmailProviderConfigContents for 'config'
// after discriminating by 'type'. For now, the generic Record<string, any> is used.
// =======================================================================================
