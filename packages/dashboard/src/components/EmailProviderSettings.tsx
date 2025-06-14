import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Typography,
} from "@mui/material";
import {
  EmailProviderType,
  WorkspaceId,
  CreateEmailProviderRequest,
  UpdateEmailProviderRequest as ApiUpdateEmailProviderRequest, // aliasing to avoid conflict
} from "isomorphic-lib/src/types";
import React, { useState } from "react";

import {
  useCreateEmailProvider,
  useDeleteEmailProvider,
  useFetchDefaultEmailProvider,
  useFetchEmailProviders,
  useSetDefaultEmailProvider,
  useUpdateEmailProvider,
  EmailProviderListItem as EmailProviderListItemDto, // DTO from appsApi
  CreateEmailProviderRequest as AppApiCreateEmailProviderRequest, // DTO from appsApi
  UpdateEmailProviderRequest as AppApiUpdateEmailProviderRequest, // DTO from appsApi
  EmailProviderConfigContents, // Generic config from appsApi for form state
} from "../lib/appsApi"; // Assuming appsApi is in lib
import EmailProviderForm, {
  // UpdateEmailProviderRequestDto as FormUpdateDto, // Using AppApi types directly
  // CreateEmailProviderRequestDto as FormCreateDto, // Using AppApi types directly
} from "./EmailProviderForm";
import EmailProviderList from "./EmailProviderList";

interface EmailProviderSettingsProps {
  workspaceId: WorkspaceId;
}

// Filter out Gmail from EmailProviderType enum for the form's dropdown
// This assumes EmailProviderType is an enum from isomorphic-lib
const availableEmailProviderTypes = Object.values(EmailProviderType).filter(
  (type) => type !== "Gmail" && type !== EmailProviderType.Gmail, // handles if it's string or enum
) as EmailProviderType[];

const EmailProviderSettings: React.FC<EmailProviderSettingsProps> = ({
  workspaceId,
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProvider, setEditingProvider] =
    useState<EmailProviderListItemDto | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    data: providers,
    isLoading: isLoadingProviders,
    error: fetchProvidersError,
  } = useFetchEmailProviders(workspaceId);

  const {
    data: defaultProviderResource,
    isLoading: isLoadingDefaultProvider,
    error: fetchDefaultProviderError,
  } = useFetchDefaultEmailProvider(workspaceId);

  const queryError = fetchProvidersError || fetchDefaultProviderError;
  const isLoadingList = isLoadingProviders || isLoadingDefaultProvider;

  const createProviderMutation = useCreateEmailProvider();
  const updateProviderMutation = useUpdateEmailProvider();
  const deleteProviderMutation = useDeleteEmailProvider();
  const setDefaultProviderMutation = useSetDefaultEmailProvider();

  const handleAddProviderClick = () => {
    setEditingProvider(null);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleEditProviderClick = (provider: EmailProviderListItemDto) => {
    setEditingProvider(provider);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingProvider(null);
    setFormError(null);
  };

  const handleFormSubmit = async (
    formData: AppApiCreateEmailProviderRequest | AppApiUpdateEmailProviderRequest,
  ) => {
    setFormError(null);
    try {
      if (editingProvider?.id) {
        // Update
        await updateProviderMutation.mutateAsync({
          providerId: editingProvider.id,
          workspaceId, // workspaceId is part of the UpdateEmailProviderRequest in appsApi
          ...(formData as AppApiUpdateEmailProviderRequest), // Send only name/config for update
        });
      } else {
        // Create
        await createProviderMutation.mutateAsync(
          formData as AppApiCreateEmailProviderRequest, // workspaceId is already in formData
        );
      }
      handleFormClose();
    } catch (err) {
      const errorMessage =
        (err as any)?.response?.data?.message ||
        (err as Error)?.message ||
        "An unexpected error occurred.";
      setFormError(errorMessage);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    // Consider adding a confirmation dialog here
    try {
      await deleteProviderMutation.mutateAsync({ workspaceId, providerId });
    } catch (err) {
      // Handle error (e.g., show a notification)
      console.error("Failed to delete provider:", err);
      // Optionally set a global error state for the list view
    }
  };

  const handleSetDefaultProvider = async (providerId: string) => {
    try {
      await setDefaultProviderMutation.mutateAsync({ workspaceId, providerId });
    } catch (err) {
      // Handle error
      console.error("Failed to set default provider:", err);
      // Optionally set a global error state
    }
  };

  return (
    <Paper sx={{ p: 2, mt: 2 }}>
      <Typography variant="h5" gutterBottom>
        Email Provider Configurations
      </Typography>
      <Box sx={{ mb: 2 }}>
        <Button
          variant="contained"
          onClick={handleAddProviderClick}
          disabled={isLoadingList}
        >
          Add New Provider
        </Button>
      </Box>

      {queryError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Error fetching provider data: {(queryError as Error).message}
        </Alert>
      )}

      <EmailProviderList
        providers={providers || []}
        defaultProviderId={defaultProviderResource?.emailProviderId || null}
        isLoading={isLoadingList}
        onEdit={handleEditProviderClick}
        onDelete={handleDeleteProvider}
        onSetDefault={handleSetDefaultProvider}
      />

      {isFormOpen && (
        <EmailProviderForm
          open={isFormOpen}
          onClose={handleFormClose}
          onSubmit={handleFormSubmit}
          initialData={editingProvider ?? undefined} // Pass undefined if null
          workspaceId={workspaceId}
          emailProviderTypes={availableEmailProviderTypes}
          // Pass mutation loading states to the form
          isLoading={
            createProviderMutation.isLoading || updateProviderMutation.isLoading
          }
          // Pass form-specific error to be displayed within the dialog
          error={formError}
        />
      )}
    </Paper>
  );
};

export default EmailProviderSettings;
