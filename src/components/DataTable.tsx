import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Column<T> {
  key: string;
  label: string;
  render?: (item: T) => React.ReactNode;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  onDelete?: (ids: string[]) => void;
  onDeleteSingle?: (id: string) => void;
  getItemId: (item: T) => string;
  emptyMessage?: string;
}

export default function DataTable<T>({
  data,
  columns,
  onDelete,
  onDeleteSingle,
  getItemId,
  emptyMessage = 'Aucune donnée'
}: DataTableProps<T>) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<'multiple' | string>('multiple');

  const toggleSelectAll = () => {
    if (selectedIds.size === data.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.map(item => getItemId(item))));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleDeleteMultiple = () => {
    setDeleteTarget('multiple');
    setShowDeleteDialog(true);
  };

  const handleDeleteSingle = (id: string) => {
    setDeleteTarget(id);
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    if (deleteTarget === 'multiple') {
      onDelete?.(Array.from(selectedIds));
      setSelectedIds(new Set());
    } else {
      onDeleteSingle?.(deleteTarget);
    }
    setShowDeleteDialog(false);
  };

  return (
    <>
      <div className="space-y-4">
        {selectedIds.size > 0 && onDelete && (
          <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <span className="text-sm font-medium text-blue-900">
              {selectedIds.size} élément(s) sélectionné(s)
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteMultiple}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Supprimer la sélection
            </Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                {(onDelete || onDeleteSingle) && (
                  <th className="text-left py-3 px-4 w-12">
                    {onDelete && (
                      <Checkbox
                        checked={selectedIds.size === data.length && data.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    )}
                  </th>
                )}
                {columns.map((column) => (
                  <th key={column.key} className="text-left py-3 px-4 font-semibold text-gray-700">
                    {column.label}
                  </th>
                ))}
                {onDeleteSingle && (
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((item) => {
                const id = getItemId(item);
                return (
                  <tr key={id} className="border-b border-gray-100 hover:bg-gray-50">
                    {(onDelete || onDeleteSingle) && (
                      <td className="py-3 px-4">
                        {onDelete && (
                          <Checkbox
                            checked={selectedIds.has(id)}
                            onCheckedChange={() => toggleSelect(id)}
                          />
                        )}
                      </td>
                    )}
                    {columns.map((column) => (
                      <td key={column.key} className="py-3 px-4">
                        {column.render ? column.render(item) : (item as any)[column.key]}
                      </td>
                    ))}
                    {onDeleteSingle && (
                      <td className="py-3 px-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteSingle(id)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              {emptyMessage}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget === 'multiple'
                ? `Êtes-vous sûr de vouloir supprimer ${selectedIds.size} élément(s) ? Cette action est irréversible.`
                : 'Êtes-vous sûr de vouloir supprimer cet élément ? Cette action est irréversible.'
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}