let imagesData = [];
let filteredData = [];
let currentSort = { column: 4, ascending: false }; // Default sort by file size descending

async function scrapeImages() {
  const url = document.getElementById('urlInput').value.trim();
  const errorDiv = document.getElementById('error');
  const resultsDiv = document.getElementById('results');
  const loading = document.getElementById('loading');
  const btnText = document.getElementById('btnText');
  const scrapeBtn = document.getElementById('scrapeBtn');

  if (!url) {
    showError('Please enter a URL');
    return;
  }

  errorDiv.style.display = 'none';
  resultsDiv.style.display = 'none';
  loading.classList.add('active');
  btnText.style.display = 'none';
  scrapeBtn.disabled = true;

  try {
    const response = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to scrape');
    }

    imagesData = data.images;
    filteredData = [...imagesData];

    // Sort by file size by default
    sortByFileSize();

    displayResults(filteredData, data.count);
  } catch (error) {
    showError(error.message);
  } finally {
    loading.classList.remove('active');
    btnText.style.display = 'inline';
    scrapeBtn.disabled = false;
  }
}

function filterImages() {
  const filter = document.getElementById('sizeFilter').value;

  if (filter === 'all') {
    filteredData = [...imagesData];
  } else {
    filteredData = imagesData.filter(img => {
      const bytes = img.fileSizeBytes;

      if (filter === 'large') return bytes > 500 * 1024;
      if (filter === 'medium') return bytes >= 100 * 1024 && bytes <= 500 * 1024;
      if (filter === 'small') return bytes > 0 && bytes < 100 * 1024;
      if (filter === 'unknown') return bytes === 0;

      return true;
    });
  }

  displayResults(filteredData, imagesData.length);
}

function sortByFileSize() {
  filteredData.sort((a, b) => b.fileSizeBytes - a.fileSizeBytes);
}

function sortTable(column) {
  if (currentSort.column === column) {
    currentSort.ascending = !currentSort.ascending;
  } else {
    currentSort.column = column;
    currentSort.ascending = false;
  }

  filteredData.sort((a, b) => {
    let valA, valB;

    switch(column) {
      case 0: // Index
        return 0; // Don't sort by index
      case 2: // URL
        valA = a.url.toLowerCase();
        valB = b.url.toLowerCase();
        break;
      case 3: // Dimensions
        valA = a.width + a.height;
        valB = b.width + b.height;
        break;
      case 4: // File Size
        valA = a.fileSizeBytes;
        valB = b.fileSizeBytes;
        break;
      case 5: // Alt Text
        valA = a.alt.toLowerCase();
        valB = b.alt.toLowerCase();
        break;
      default:
        return 0;
    }

    if (valA < valB) return currentSort.ascending ? -1 : 1;
    if (valA > valB) return currentSort.ascending ? 1 : -1;
    return 0;
  });

  displayResults(filteredData, imagesData.length);
}

function displayResults(images, totalCount) {
  document.getElementById('count').textContent = totalCount;
  document.getElementById('filteredCount').textContent = images.length;
  document.getElementById('results').style.display = 'block';

  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';

  images.forEach((img, idx) => {
    const row = tbody.insertRow();

    // Shorten URL for display
    const urlObj = new URL(img.url);
    const fileName = urlObj.pathname.split('/').pop() || 'image';
    const shortUrl = fileName.length > 40 ? fileName.substring(0, 37) + '...' : fileName;

    row.innerHTML = `
      <td>${idx + 1}</td>
      <td>
        <a href="${img.url}" target="_blank" title="Click to open image in new tab">
          <img src="${img.url}" class="preview" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22><rect fill=%22%23333%22 width=%2280%22 height=%2280%22/><text x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22 font-size=%2212%22>Error</text></svg>'" alt="Preview">
        </a>
      </td>
      <td class="url-cell">
        <a href="${img.url}" target="_blank" class="url-link" title="${img.url}">${shortUrl}</a>
      </td>
      <td>${img.width} × ${img.height}</td>
      <td>${img.fileSize}</td>
      <td>${img.alt}</td>
    `;
  });
}

function showError(message) {
  const errorDiv = document.getElementById('error');
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
}

function exportCSV() {
  const headers = ['#', 'Image URL', 'Dimensions', 'File Size', 'Alt Text'];
  const rows = filteredData.map((img, idx) => [
    idx + 1,
    img.url,
    `${img.width} × ${img.height}`,
    img.fileSize,
    img.alt
  ]);

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'scraped-images.csv';
  a.click();
  window.URL.revokeObjectURL(url);
}

document.getElementById('urlInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') scrapeImages();
});