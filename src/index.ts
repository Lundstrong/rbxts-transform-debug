/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import path from "path";
import ts, { factory } from "typescript";
import fs from "fs";
import { transformToInlineDebugPrint, transformToIIFEDebugPrint } from "./dbg";
import { transformError, transformPrint, transformWarning } from "./print";
import { formatTransformerDebug, formatTransformerDiagnostic, formatTransformerWarning } from "./shared";
import chalk from "chalk";
import { transformNameOf } from "./nameof";
import { transformCommitId, transformGit } from "./git";

const sourceText = fs.readFileSync(path.join(__dirname, "..", "index.d.ts"), "utf8");
function isModule(sourceFile: ts.SourceFile) {
	return sourceFile.text === sourceText;
}

function isModuleImportExpression(node: ts.Node, program: ts.Program): node is ts.ImportDeclaration {
	if (!ts.isImportDeclaration(node)) {
		return false;
	}

	if (!node.importClause) {
		return false;
	}

	const namedBindings = node.importClause.namedBindings;
	if (!node.importClause.name && !namedBindings) {
		return false;
	}

	const importSymbol = program.getTypeChecker().getSymbolAtLocation(node.moduleSpecifier);

	if (!importSymbol || !importSymbol.valueDeclaration || !isModule(importSymbol.valueDeclaration.getSourceFile())) {
		return false;
	}

	return true;
}

function visitNodeAndChildren(
	node: ts.SourceFile,
	program: ts.Program,
	context: ts.TransformationContext,
	config: DebugTransformConfiguration,
): ts.SourceFile;
function visitNodeAndChildren(
	node: ts.Node,
	program: ts.Program,
	context: ts.TransformationContext,
	config: DebugTransformConfiguration,
): ts.Node | undefined;
function visitNodeAndChildren(
	node: ts.Node,
	program: ts.Program,
	context: ts.TransformationContext,
	config: DebugTransformConfiguration,
): ts.Node | undefined {
	return ts.visitEachChild(
		visitNode(node, program, config),
		(childNode) => visitNodeAndChildren(childNode, program, context, config),
		context,
	);
}

const MacroFunctionName = {
	dbg: "$dbg",
	print: "$print",
	warn: "$warn",
	error: "$error",
	commitId: "$commitId",
	git: "$git",
	nameof: "$nameof",
} as const;

function handleDebugCallExpression(
	node: ts.CallExpression,
	functionName: string,
	program: ts.Program,
	config: DebugTransformConfiguration,
) {
	if (config.verbose) console.log(formatTransformerDebug("Handling call to macro " + chalk.yellow(functionName), node));

	switch (functionName) {
		case MacroFunctionName.dbg: {
			const [expression, customHandler] = node.arguments;
			if (ts.isExpressionStatement(node.parent) && customHandler === undefined) {
				return config.enabled
					? transformToInlineDebugPrint(expression, config)
					: ts.isCallExpression(expression)
					? expression
					: factory.createVoidExpression(factory.createIdentifier("undefined"));
			}
			return config.enabled ? transformToIIFEDebugPrint(expression, customHandler, program, config) : expression;
		}
		case MacroFunctionName.commitId: {
			return transformCommitId(node);
		}
		case MacroFunctionName.git: {
			return transformGit(node);
		}
		case MacroFunctionName.print: {
			return config.enabled ? transformPrint(node, config) : factory.createVoidExpression(factory.createIdentifier("undefined"));
		}
		case MacroFunctionName.warn: {
			return config.enabled
				? transformWarning(node, config)
				: factory.createVoidExpression(factory.createIdentifier("undefined"));
		}
		case MacroFunctionName.error: {
			return config.enabled ? transformError(node, config) : factory.createVoidExpression(factory.createIdentifier("undefined"));
		}
		case MacroFunctionName.nameof: {
			if (ts.isExpressionStatement(node.parent)) {
				console.log(
					formatTransformerWarning(
						`Call to ${node.getText()}, which is not used anywhere. It has been stripped.`,
						node,
					),
				);
				return factory.createVoidExpression(factory.createIdentifier("undefined"));
			} else {
				return transformNameOf(node, program);
			}
		}
		default:
			throw formatTransformerDiagnostic(
				`function ${chalk.yellow(functionName)} cannot be handled by this version of rbxts-transform-debug`,
			);
	}
}

function visitCallExpression(node: ts.CallExpression, program: ts.Program, config: DebugTransformConfiguration) {
	const typeChecker = program.getTypeChecker();
	const signature = typeChecker.getResolvedSignature(node);
	if (!signature) {
		return node;
	}
	const { declaration } = signature;
	if (!declaration || ts.isJSDocSignature(declaration) || !isModule(declaration.getSourceFile())) {
		return node;
	}

	const functionName = declaration.name && declaration.name.getText();
	if (!functionName) {
		return node;
	}

	return handleDebugCallExpression(node, functionName, program, config);
}

function visitNode(node: ts.SourceFile, program: ts.Program, config: DebugTransformConfiguration): ts.SourceFile;
function visitNode(node: ts.Node, program: ts.Program, config: DebugTransformConfiguration): ts.Node | undefined;
function visitNode(
	node: ts.Node,
	program: ts.Program,
	config: DebugTransformConfiguration,
): ts.Node | ts.Node[] | undefined {
	if (isModuleImportExpression(node, program)) {
		const { importClause } = node;

		if (importClause !== undefined && importClause.isTypeOnly) {
			return node;
		}

		if (importClause !== undefined) {
			return factory.updateImportDeclaration(
				node,
				undefined,
				undefined,
				factory.updateImportClause(importClause, true, importClause.name, importClause.namedBindings),
				node.moduleSpecifier,
			);
		}

		return factory.createExportDeclaration(
			undefined,
			undefined,
			false,
			ts.factory.createNamedExports([]),
			undefined,
		);
	}

	if (ts.isCallExpression(node)) {
		return visitCallExpression(node, program, config);
	}

	return node;
}

export interface DebugTransformConfiguration {
	enabled: boolean;
	scope?: string;
	verbose?: boolean;
	environmentRequires?: Record<string, string | boolean>;
}

const DEFAULTS: DebugTransformConfiguration = {
	enabled: true,
};

export default function transform(program: ts.Program, userConfiguration: DebugTransformConfiguration) {
	userConfiguration = { ...DEFAULTS, ...userConfiguration };
	if (userConfiguration.environmentRequires) {
		for (const [k, v] of Object.entries(userConfiguration.environmentRequires)) {
			if (
				(typeof v === "boolean" && process.env[k] === undefined) ||
				(typeof v === "string" && process.env[k] !== v)
			) {
				userConfiguration.enabled = false;
			}
		}
	}

	if (userConfiguration.verbose) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		console.log(formatTransformerDebug("Running version " + require("../package.json").version));
		console.log(formatTransformerDebug(`Macros enabled: ${chalk.cyan(userConfiguration.enabled)}`));
	}

	return (context: ts.TransformationContext) => (file: ts.SourceFile) =>
		visitNodeAndChildren(file, program, context, userConfiguration);
}
