const { convert } = require('pdf-poppler');
const path = require('path');
const fs = require('fs');

async function pdfToImages(pdfPath) {
  const pdfBaseName = path.basename(pdfPath, path.extname(pdfPath)); // e.g. "paper"
  const outputDir = path.join(__dirname, "uploads", "pages", pdfBaseName);

  // Create uploads/pages/<pdfName>/ folder
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Clear old images
  fs.readdirSync(outputDir).forEach(f => {
    if (f.endsWith(".png")) {
      fs.unlinkSync(path.join(outputDir, f));
    }
  });

  const options = {
    format: 'png',
    out_dir: outputDir,
    out_prefix: pdfBaseName,
    page: null
  };

  // ⬇⬇⬇ Debugging logs (INSIDE the function)
  console.log("Converting PDF:", pdfPath);
  console.log("Output directory:", outputDir);

  await convert(pdfPath, options);

  console.log("Done converting. Files in folder:", fs.readdirSync(outputDir));

  return fs.readdirSync(outputDir)
    .filter(f => f.endsWith(".png"))
    .map(f => path.join(outputDir, f));
}

module.exports = pdfToImages;