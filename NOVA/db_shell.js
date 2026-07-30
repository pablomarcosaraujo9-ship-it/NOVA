const { exec } = require('child_process');
const path = require('path');

// Caminho para o banco de dados do bot Python (SQLite)
const dbPath = path.resolve(__dirname, '../bot_investimentos/database/investimentos.db');

function querySQLite(sql, callback) {
    const cmd = `sqlite3 "${dbPath}" "${sql.replace(/"/g, '\\"')}"`;
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            callback(error, null);
            return;
        }
        if (stderr) {
            callback(new Error(stderr), null);
            return;
        }
        const lines = stdout.trim().split('\n').filter(line => line);
        const rows = lines.map(line => line.split('|'));
        callback(null, rows);
    });
}

// Buscar carteira
function getPortfolio(callback) {
    const sql = "SELECT ticker, quantidade, preco_compra FROM portfolio";
    querySQLite(sql, (err, rows) => {
        if (err) return callback(err, null);
        const result = rows.map(row => ({
            ticker: row[0],
            quantidade: parseInt(row[1]),
            preco_compra: parseFloat(row[2])
        }));
        callback(null, result);
    });
}

// Buscar alertas ativos
function getAlerts(callback) {
    const sql = "SELECT id, ticker, tipo, percentual, condicao FROM alerts WHERE ativo = 1";
    querySQLite(sql, (err, rows) => {
        if (err) return callback(err, null);
        const result = rows.map(row => ({
            id: parseInt(row[0]),
            ticker: row[1],
            tipo: row[2],
            percentual: parseFloat(row[3]),
            condicao: row[4]
        }));
        callback(null, result);
    });
}

// Adicionar alerta
function addAlert(ticker, tipo, percentual, condicao, callback) {
    const sql = `INSERT INTO alerts (ticker, tipo, quantidade, percentual, condicao, ativo) VALUES ('${ticker.toUpperCase()}', '${tipo}', 0, ${percentual}, '${condicao}', 1)`;
    querySQLite(sql, (err) => {
        if (err) return callback(err, null);
        callback(null, { success: true });
    });
}

// Adicionar à carteira
function addPortfolio(ticker, quantidade, preco_compra, callback) {
    const sql = `INSERT INTO portfolio (ticker, quantidade, preco_compra) VALUES ('${ticker.toUpperCase()}', ${quantidade}, ${preco_compra})`;
    querySQLite(sql, (err) => {
        if (err) return callback(err, null);
        callback(null, { success: true });
    });
}

module.exports = { getPortfolio, getAlerts, addAlert, addPortfolio };
