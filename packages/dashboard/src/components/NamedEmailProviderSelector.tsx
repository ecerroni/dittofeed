import {
  CircularProgress,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
} from "@mui/material";
import { WorkspaceId } from "isomorphic-lib/src/types";
import React from "react";

import {
  useFetchDefaultEmailProvider,
  useFetchEmailProviders,
  EmailProviderListItem as EmailProviderListItemDto,
} from "../lib/appsApi";

export const SYSTEM_DEFAULT_PROVIDER_ID = "system-default";

interface NamedEmailProviderSelectorProps {
  workspaceId: WorkspaceId;
  value: string | null; // Can be provider.id, SYSTEM_DEFAULT_PROVIDER_ID, or null for unselected
  onChange: (selectedValue: string | null) => void;
  label?: string;
  disabled?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
}

const NamedEmailProviderSelector: React.FC<NamedEmailProviderSelectorProps> = ({
  workspaceId,
  value,
  onChange,
  label = "Email Provider",
  disabled,
  error,
  helperText,
}) => {
  const {
    data: providers,
    isLoading: isLoadingProviders,
    isError: isErrorProviders,
    error: providersError,
  } = useFetchEmailProviders(workspaceId);

  const {
    data: defaultProviderResource,
    isLoading: isLoadingDefault,
    // isError: isErrorDefault, // can be used if specific error handling for default is needed
    // error: defaultProviderError,
  } = useFetchDefaultEmailProvider(workspaceId);

  const isLoading = isLoadingProviders || isLoadingDefault;

  const handleSelectionChange = (event: SelectChangeEvent<string | null>) => {
    onChange(event.target.value as string | null);
  };

  let defaultProviderLabel = "Workspace Default";
  if (defaultProviderResource && providers) {
    const actualDefault = providers.find(
      (p) => p.id === defaultProviderResource.emailProviderId,
    );
    if (actualDefault) {
      defaultProviderLabel = `Workspace Default (Currently: ${actualDefault.name} - ${actualDefault.type})`;
    } else if (defaultProviderResource.emailProviderId) {
      // Default is set but not in the fetched list (should ideally not happen)
      defaultProviderLabel = `Workspace Default (ID: ${defaultProviderResource.emailProviderId.substring(0, 8)}...)`;
    }
  } else if (isLoadingDefault) {
    defaultProviderLabel = "Workspace Default (Loading...)";
  }


  if (isErrorProviders) {
    return (
      <FormControl fullWidth error={isErrorProviders || error}>
        <InputLabel id={`${label}-select-label`}>{label}</InputLabel>
        <Select
          labelId={`${label}-select-label`}
          value=""
          label={label}
          disabled
        >
          <MenuItem value="" disabled>
            Error loading providers: {providersError?.message}
          </MenuItem>
        </Select>
        {helperText && <FormHelperText>{helperText}</FormHelperText>}
      </FormControl>
    );
  }

  return (
    <FormControl fullWidth error={error} disabled={disabled || isLoading}>
      <InputLabel id={`${label}-select-label`}>{label}</InputLabel>
      <Select
        labelId={`${label}-select-label`}
        value={isLoading ? "" : value ?? ""} // Use empty string for select if value is null/undefined or loading
        onChange={handleSelectionChange}
        label={label}
      >
        {isLoading ? (
          <MenuItem value="" disabled>
            <CircularProgress size={20} sx={{ mr: 1 }} />
            Loading Providers...
          </MenuItem>
        ) : (
          [
            <MenuItem key="system-default" value={SYSTEM_DEFAULT_PROVIDER_ID}>
              {defaultProviderLabel}
            </MenuItem>,
            ...(providers ?? []).map((provider) => (
              <MenuItem key={provider.id} value={provider.id}>
                {provider.name} ({provider.type})
              </MenuItem>
            )),
          ]
        )}
      </Select>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
};

export default NamedEmailProviderSelector;
