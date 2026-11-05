import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/toast";
import { BrandAssets } from "./BrandAssets";

let role = "manager";
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ me: { id: "u1", role }, canEdit: role === "manager" }) }));
vi.mock("@/features/shared/AssetImage", () => ({ AssetImage: ({ alt }: { alt: string }) => <img alt={alt} /> }));

const rows = [
  { id: "a1", campaign_id: "c1", kind: "logo", file_name: "BigCity-logo.svg", storage_path: "c1/x-logo.svg", mime_type: "image/svg+xml", size_bytes: 2048 },
  { id: "a2", campaign_id: "c1", kind: "font", file_name: "Inter.ttf", storage_path: "c1/x-inter.ttf", mime_type: "font/ttf", size_bytes: 90000 },
];
const svc = vi.hoisted(() => ({ list: vi.fn(), upload: vi.fn(), update: vi.fn(), remove: vi.fn(), downloadUrl: vi.fn() }));
vi.mock("@/services/brandAssets", () => ({ brandAssetsService: svc }));

const campaign = (member: boolean) => ({ id: "c1", campaign_members: member ? [{ user_id: "u1" }] : [] }) as never;
const show = (member = false) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><BrandAssets campaign={campaign(member)} /></ToastProvider></QueryClientProvider>,
);

beforeEach(() => { vi.clearAllMocks(); svc.list.mockResolvedValue(rows); svc.upload.mockResolvedValue({}); });

describe("BrandAssets", () => {
  it("lets a manager add, relabel, rename and delete", async () => {
    role = "manager"; show();
    await screen.findByText("BigCity-logo.svg");
    expect(screen.getByRole("button", { name: /Add assets/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete BigCity-logo.svg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename Inter.ttf" })).toBeInTheDocument();
    expect(screen.getByLabelText("Label for Inter.ttf")).toBeInTheDocument();
  });

  it("lets a team member on the campaign change them too", async () => {
    role = "team_member"; show(true);
    await screen.findByText("BigCity-logo.svg");
    expect(screen.getByRole("button", { name: /Add assets/ })).toBeInTheDocument();
  });

  it("lets everyone else view and download only", async () => {
    role = "viewer"; show();
    await screen.findByText("BigCity-logo.svg");
    expect(screen.getByRole("button", { name: "Download BigCity-logo.svg" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add assets/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Rename/ })).toBeNull();
    expect(screen.queryByLabelText(/Label for/)).toBeNull();
    expect(screen.getByText(/can view and download these/)).toBeInTheDocument();
  });

  it("treats a team member who is not on this campaign as a viewer", async () => {
    role = "team_member"; show(false);
    await screen.findByText("BigCity-logo.svg");
    expect(screen.queryByRole("button", { name: /Add assets/ })).toBeNull();
  });

  it("uploads picked files and reports failures without losing the rest", async () => {
    role = "manager"; svc.upload.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("run.exe: that file type is not allowed here."));
    const { container } = show();
    await screen.findByText("BigCity-logo.svg");
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "logo.svg", { type: "image/svg+xml" }), new File(["x"], "run.exe")] } });
    await waitFor(() => expect(svc.upload).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/not allowed here/)).toBeInTheDocument();
  });

  it("asks before deleting", async () => {
    role = "manager"; show();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Inter.ttf" }));
    expect(svc.remove).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(svc.remove).toHaveBeenCalledWith(expect.objectContaining({ id: "a2" })));
  });
});
