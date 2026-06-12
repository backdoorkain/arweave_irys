const express = require('express');
const multer = require('multer');
const { Uploader } = require('@irys/sdk');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

// Inicializar la conexión de subida con Irys apuntando a Arweave Mainnet
let irysUploader;
try {
    if (process.env.ARWEAVE_WALLET) {
        const wallet = JSON.parse(process.env.ARWEAVE_WALLET);
        
        // Configuramos Irys para usar el nodo 1 de producción con el token de Arweave
        irysUploader = new Uploader({
            endpoint: "https://irys.xyz",
            token: "arweave",
            key: wallet,
        });

        console.log(`>>> Conectado exitosamente a Irys Mainnet.`);
    } else {
        console.error(">>> ERROR DE SEGURIDAD: Falta definir la variable ARWEAVE_WALLET.");
    }
} catch (error) {
    console.error(">>> ERROR al inicializar Irys:", error.message);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- RUTA: SUBIR ARCHIVO MEDIANTE BUNDLES ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo.' });
        if (!irysUploader) return res.status(500).json({ error: 'Infratructura Irys no lista.' });

        const fileData = fs.readFileSync(path.resolve(req.file.path));
        const dataBuffer = Buffer.from(fileData);

        // Definir las etiquetas (Tags) idénticas para mantener compatibilidad
        const tags = [
            { name: 'Content-Type', value: req.file.mimetype },
            { name: 'App-Name', value: 'MiArweaveIrysUploader' },
            { name: 'File-Name', value: req.file.originalname }
        ];

        // Subir directamente a través del empaquetador de Irys
        // Nota: Si el archivo pesa menos de 100 KB, Irys no descontará saldo de tu AR
        const receipt = await irysUploader.upload(dataBuffer, { tags });

        // Limpieza del archivo temporal local
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        return res.json({
            success: true,
            txId: receipt.id, // Este ID es el identificador definitivo en Arweave
            message: "¡Archivo subido e indexado de forma instantánea!"
        });

    } catch (error) {
        console.error("Fallo en Irys:", error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(500).json({ error: `Error en la red Irys: ${error.message}` });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor de Irys corriendo en http://localhost:${PORT}`);
});
