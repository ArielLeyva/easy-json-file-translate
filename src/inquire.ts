type InquirerModule = typeof import("@inquirer/prompts");
let inquirer: InquirerModule | null = null;
export async function loadInquirer(): Promise<InquirerModule | null> {
  if (inquirer) return inquirer;
  if (!process.stdin.isTTY) return null;
  try {
    inquirer = (await import("@inquirer/prompts")) as InquirerModule;
    return inquirer;
  } catch {
    return null;
  }
}
