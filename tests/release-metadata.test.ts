import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
for (const name of ["letta-a2a-client", "letta-a2a-bridge"]) {
  const directory = resolve(root, "packages", name);
  const manifest = JSON.parse(
    readFileSync(resolve(directory, "package.json"), "utf8"),
  );
  test(`${name} declares a gated MIT prerelease with an exact support baseline`, () => {
    expect(manifest.name).toBe(name);
    expect(manifest.version).toBe("0.1.0-alpha.1");
    // Publication is a separate owner action; preparation must not enable it silently.
    expect(manifest.private).toBe(true);
    expect(manifest.license).toBe("MIT");
    expect(manifest.engines.node).toBe(">=24.19.0 <25");
    expect(manifest.packageManager).toBe("bun@1.4.2");
    expect(manifest.repository.directory).toBe(`packages/${name}`);
    expect(manifest.repository.url).toBe(
      "git+https://github.com/klittle32/letta-a2a.git",
    );
    expect(manifest.dependencies["@a2a-js/sdk"]).toBe("1.1.0");
    expect(manifest.scripts.prepublishOnly).toContain(
      "Publication requires separate approval",
    );
  });
  test(`${name} distributes license and prerelease history`, () => {
    const license = readFileSync(resolve(root, "LICENSE"), "utf8");
    expect(license).toContain("MIT License");
    expect(readFileSync(resolve(directory, "LICENSE"), "utf8")).toBe(license);
    expect(manifest.files).toContain("CHANGELOG.md");
    expect(readFileSync(resolve(directory, "CHANGELOG.md"), "utf8")).toContain(
      "0.1.0-alpha.1",
    );
  });
}

test("the standalone mod carries its bundled SDK license", () => {
  const directory = resolve(root, "packages/letta-a2a-client");
  const manifest = JSON.parse(
    readFileSync(resolve(directory, "package.json"), "utf8"),
  );
  expect(manifest.files).toContain("THIRD_PARTY_NOTICES.md");
  expect(
    readFileSync(resolve(directory, "THIRD_PARTY_NOTICES.md"), "utf8"),
  ).toContain("@a2a-js/sdk 1.1.0");
  expect(
    readFileSync(resolve(directory, "THIRD_PARTY_NOTICES.md"), "utf8"),
  ).toContain("Apache License");
});

test("bridge consumers receive the Express types exposed by its public declarations", () => {
  const manifest = JSON.parse(
    readFileSync(
      resolve(root, "packages/letta-a2a-bridge/package.json"),
      "utf8",
    ),
  );
  expect(manifest.dependencies["@types/express"]).toBe("5.0.3");
});

test("provider-free CI does not execute dependency installation hooks", () => {
  const workflow = readFileSync(
    resolve(root, ".github/workflows/release-checks.yml"),
    "utf8",
  );
  const installs = workflow
    .split("\n")
    .filter((line) => line.includes("bun install"));
  expect(installs.length).toBe(4);
  for (const line of installs) expect(line).toContain("--ignore-scripts");
});
