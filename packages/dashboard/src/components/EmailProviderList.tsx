import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import StarIcon from "@mui/icons-material/Star";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import { EmailProviderType, WorkspaceId } from "isomorphic-lib/src/types";
import React from "react";

// TODO: Consolidate with types in appsApi.ts or isomorphic-lib
// Using Dto suffix to indicate these are for component/data transfer, not necessarily direct DB entities
export interface EmailProviderListItemDto {
  id: string;
  workspaceId: WorkspaceId; // May not be needed for display but good for context
  name: string;
  type: EmailProviderType;
}
// End of placeholder types

interface EmailProviderListProps {
  providers: EmailProviderListItemDto[];
  defaultProviderId?: string | null;
  onEdit: (provider: EmailProviderListItemDto) => void;
  onDelete: (providerId: string) => void;
  onSetDefault: (providerId: string) => void;
  isLoading?: boolean;
}

const EmailProviderList: React.FC<EmailProviderListProps> = ({
  providers,
  defaultProviderId,
  onEdit,
  onDelete,
  onSetDefault,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" p={3}>
        <CircularProgress />
      </Box>
    );
  }

  if (providers.length === 0) {
    return (
      <Typography variant="body1" p={2} textAlign="center">
        No email providers configured.
      </Typography>
    );
  }

  return (
    <TableContainer component={Paper}>
      <Table sx={{ minWidth: 650 }} aria-label="email providers table">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Default</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {providers.map((provider) => (
            <TableRow
              key={provider.id}
              sx={{ "&:last-child td, &:last-child th": { border: 0 } }}
            >
              <TableCell component="th" scope="row">
                {provider.name}
              </TableCell>
              <TableCell>{provider.type}</TableCell>
              <TableCell>
                {provider.id === defaultProviderId && (
                  <Tooltip title="Default Provider">
                    <StarIcon color="primary" />
                  </Tooltip>
                )}
              </TableCell>
              <TableCell align="right">
                <Tooltip title="Edit Provider">
                  <IconButton onClick={() => onEdit(provider)} size="small">
                    <EditIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete Provider">
                  <IconButton
                    onClick={() => onDelete(provider.id)}
                    size="small"
                    color="error"
                  >
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
                <Button
                  onClick={() => onSetDefault(provider.id)}
                  disabled={provider.id === defaultProviderId}
                  size="small"
                  variant="outlined"
                  sx={{ ml: 1 }}
                >
                  Set as Default
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default EmailProviderList;
