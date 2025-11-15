import { AuthProvider } from "@/providers/AuthProvider";
import { ModalProvider } from "@/providers/ModalProvider";
import { TooltipProvider } from "@/providers/TooltipProvider";

export const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <AuthProvider>
      <TooltipProvider>
        <ModalProvider>{children}</ModalProvider>
      </TooltipProvider>
    </AuthProvider>
  );
};
