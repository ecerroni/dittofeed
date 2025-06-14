import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Stack,
  TextField,
} from "@mui/material";
import {
  EmailProviderType,
  WorkspaceId,
} from "isomorphic-lib/src/types";
import React, { useEffect, useState } from "react";

// Assuming these types are (or will be) defined in a shared types location or appsApi.ts
// For now, defining them locally for clarity within the form.
// TODO: Consolidate with types in appsApi.ts or isomorphic-lib
export interface EmailProviderConfigContentsMap {
  [EmailProviderType.Smtp]: {
    host?: string;
    port?: string;
    username?: string;
    password?: string;
  };
  [EmailProviderType.SendGrid]: {
    apiKey?: string;
  };
  [EmailProviderType.AmazonSes]: {
    accessKeyId?: string;
    secretAccessKey?: string;
    region?: string;
  };
  [EmailProviderType.Resend]: {
    apiKey?: string;
  };
  [EmailProviderType.PostMark]: {
    apiKey?: string;
  };
  [EmailProviderType.MailChimp]: {
    apiKey?: string;
  };
  [EmailProviderType.Test]: Record<string, never>; // No config for Test type
}

export type SpecificEmailProviderConfigContents =
  EmailProviderConfigContentsMap[keyof EmailProviderConfigContentsMap];

// Request types for onSubmit prop
// These should ideally match the request types used by the API client (e.g., from appsApi.ts)
interface BaseEmailProviderRequest {
  workspaceId: WorkspaceId;
  name: string;
  type: EmailProviderType;
  // Actual API might expect config structure from EmailProviderSecret subtypes
  config: SpecificEmailProviderConfigContents;
}

export interface CreateEmailProviderRequestDto extends BaseEmailProviderRequest {}

export interface UpdateEmailProviderRequestDto
  extends Partial<Omit<BaseEmailProviderRequest, "workspaceId" | "type">> {
  // type cannot be updated
}

export interface EmailProviderListItemDto {
  id: string;
  workspaceId: WorkspaceId;
  name: string;
  type: EmailProviderType;
  config?: Partial<SpecificEmailProviderConfigContents>; // Config might not be fully exposed
}
// End of placeholder types

interface EmailProviderFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    data: CreateEmailProviderRequestDto | UpdateEmailProviderRequestDto,
  ) => Promise<void>;
  initialData?: EmailProviderListItemDto;
  workspaceId: WorkspaceId;
  emailProviderTypes: EmailProviderType[]; // Enum values
}

const EmailProviderForm: React.FC<EmailProviderFormProps> = ({
  open,
  onClose,
  onSubmit,
  initialData,
  workspaceId,
  emailProviderTypes,
}) => {
  const [name, setName] = useState("");
  const [type, setType] = useState<EmailProviderType | "">("");
  const [configFields, setConfigFields] =
    useState<Partial<SpecificEmailProviderConfigContents>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!initialData;

  useEffect(() => {
    if (initialData) {
      setName(initialData.name);
      setType(initialData.type);
      setConfigFields(initialData.config || {});
    } else {
      // Reset for "Add" mode
      setName("");
      setType("");
      setConfigFields({});
    }
  }, [initialData, open]);

  const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConfigFields((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleTypeChange = (event: SelectChangeEvent<EmailProviderType | "">) => {
    const newType = event.target.value as EmailProviderType | "";
    setType(newType);
    setConfigFields({}); // Reset config fields when type changes
  };

  const resetForm = () => {
    setName("");
    setType("");
    setConfigFields({});
    setIsLoading(false);
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!type) {
      setError("Provider type is required.");
      return;
    }
    if (!name.trim()) {
      setError("Provider name is required.");
      return;
    }

    setIsLoading(true);
    setError(null);

    const submissionData: CreateEmailProviderRequestDto | UpdateEmailProviderRequestDto =
      isEditing && initialData
        ? ({
            // For update, only send changed fields, workspaceId for auth, no type change
            name: name !== initialData.name ? name : undefined,
            config: Object.keys(configFields).length > 0 ? configFields : undefined,
          } as UpdateEmailProviderRequestDto) // Cast needed because not all fields are present
        : ({
            workspaceId,
            name,
            type,
            config: configFields,
          } as CreateEmailProviderRequestDto);

    // Ensure undefined fields are not sent if they are optional in Update request
    if (isEditing) {
        if (!submissionData.name) delete submissionData.name;
        if (!submissionData.config || Object.keys(submissionData.config).length === 0) delete submissionData.config;
    }


    try {
      await onSubmit(submissionData);
      handleClose();
    } catch (submitError: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      setError(submitError?.message || "An error occurred.");
      setIsLoading(false);
    }
  };

  const renderConfigFields = () => {
    switch (type) {
      case EmailProviderType.Smtp:
        return (
          <>
            <TextField
              margin="dense"
              name="host"
              label="SMTP Host"
              type="text"
              fullWidth
              variant="outlined"
              value={(configFields as EmailProviderConfigContentsMap[EmailProviderType.Smtp])?.host || ""}
              onChange={handleConfigChange}
            />
            <TextField
              margin="dense"
              name="port"
              label="SMTP Port"
              type="text"
              fullWidth
              variant="outlined"
              value={(configFields as EmailProviderConfigContentsMap[EmailProviderType.Smtp])?.port || ""}
              onChange={handleConfigChange}
            />
            <TextField
              margin="dense"
              name="username"
              label="Username"
              type="text"
              fullWidth
              variant="outlined"
              value={(configFields as EmailProviderConfigContentsMap[EmailProviderType.Smtp])?.username || ""}
              onChange={handleConfigChange}
            />
            <TextField
              margin="dense"
              name="password"
              label="Password"
              type="password"
              fullWidth
              variant="outlined"
              value={(configFields as EmailProviderConfigContentsMap[EmailProviderType.Smtp])?.password || ""}
              onChange={handleConfigChange}
            />
          </>
        );
      case EmailProviderType.SendGrid:
      case EmailProviderType.Resend:
      case EmailProviderType.PostMark:
      case EmailProviderType.MailChimp:
        return (
          <TextField
            margin="dense"
            name="apiKey"
            label="API Key"
            type="password"
            fullWidth
            variant="outlined"
            value={(configFields as EmailProviderConfigContentsMap[EmailProviderType.SendGrid])?.apiKey || ""}
            onChange={handleConfigChange}
          />
        );
      case EmailProviderType.AmazonSes:
        return (
          <>
            <TextField
              margin="dense"
              name="accessKeyId"
              label="Access Key ID"
              type="text"
              fullWidth
              variant="outlined"
              value={(configFields as EmailProviderConfigContentsMap[EmailProviderType.AmazonSes])?.accessKeyId || ""}
              onChange={handleConfigChange}
            />
            <TextField
              margin="dense"
              name="secretAccessKey"
              label="Secret Access Key"
              type="password"
              fullWidth
              variant="outlined"
              value={(configFields as EmailProviderConfigContentsMap[EmailProviderType.AmazonSes])?.secretAccessKey || ""}
              onChange={handleConfigChange}
            />
            <TextField
              margin="dense"
              name="region"
              label="Region"
              type="text"
              fullWidth
              variant="outlined"
              value={(configFields as EmailProviderConfigContentsMap[EmailProviderType.AmazonSes])?.region || ""}
              onChange={handleConfigChange}
            />
          </>
        );
      case EmailProviderType.Test:
        return <p>No configuration required for Test provider.</p>;
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {isEditing ? "Edit Email Provider" : "Add Email Provider"}
      </DialogTitle>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            autoFocus
            margin="dense"
            name="name"
            label="Provider Name"
            type="text"
            fullWidth
            variant="outlined"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <FormControl fullWidth margin="dense" required>
            <InputLabel id="provider-type-label">Provider Type</InputLabel>
            <Select
              labelId="provider-type-label"
              id="provider-type-select"
              value={type}
              label="Provider Type"
              onChange={handleTypeChange}
              disabled={isEditing}
            >
              {emailProviderTypes.map((typeVal) => (
                <MenuItem key={typeVal} value={typeVal}>
                  {typeVal}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {renderConfigFields()}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isLoading}>
            {isLoading ? "Saving..." : isEditing ? "Save Changes" : "Add Provider"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
};

export default EmailProviderForm;
