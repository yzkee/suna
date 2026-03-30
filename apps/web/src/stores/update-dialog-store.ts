import { create } from 'zustand';

interface UpdateDialogStore {
  open: boolean;
  openDialog: () => void;
  closeDialog: () => void;
}

export const useUpdateDialogStore = create<UpdateDialogStore>((set) => ({
  open: false,
  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
}));
