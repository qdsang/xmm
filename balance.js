exports.command = "balance <wallet>";
exports.desc = "Check balances in a wallet";
exports.aliases = [
	"b",
	"bal"
];
exports.builder = yargs => yargs;
exports.handler = connect((config, xmm) => {
	const wallet = config.wallet;
	const ledger = config.ledger;

	xmm.balance(wallet, ledger).then(lines => {
		lines = lines.map(line => line.human);
		console.info(lines.join("\n"));
		process.exit();
	}).catch(abort);
});
